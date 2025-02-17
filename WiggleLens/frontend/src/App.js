import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [image, setImage] = useState(null);
  const [fullImagePreview, setFullImagePreview] = useState(null);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [focalPoints, setFocalPoints] = useState([null, null, null]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [loadedImage, setLoadedImage] = useState(null);
  const [splitLoading, setSplitLoading] = useState(false);

  // NEW states for the next "options" screen
  const [showWiggleOptions, setShowWiggleOptions] = useState(false);
  const [frameSpeed, setFrameSpeed] = useState(0.1);  // 0.1 / 0.2 / 0.3
  const [videoLength, setVideoLength] = useState(5);  // 1..10 seconds slider
  // IMPORTANT: If useSecondFrameAsBackground is true, we'll call /api/process_image_no_rgba
  // Otherwise, we'll call /api/process_image
  const [useSecondFrameAsBackground, setUseSecondFrameAsBackground] = useState(false);

  // We'll use this for our animated dots, starting at 1 (instead of 0).
  const [processingDots, setProcessingDots] = useState(1);

  useEffect(() => {
    let interval;
    if (loading) {
      // Cycle through 1..3
      interval = setInterval(() => {
        setProcessingDots((prev) => {
          if (prev >= 3) {
            // If we're at 3, go back to 1
            return 1;
          } else {
            return prev + 1;
          }
        });
      }, 600);
    } else {
      // Reset to 1 if not loading
      setProcessingDots(1);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading]);

  // Build dynamic text, e.g. "Processing.", "Processing..", "Processing..."
  const processingText = `Processing${'.'.repeat(processingDots)}`;

  // 1) Disable scrolling in website when at 100% zoom
  useEffect(() => {
    function checkZoom() {
      if (window.devicePixelRatio === 1) {
        // Hide scrollbars
        document.documentElement.style.overflow = 'hidden';
      } else {
        // Restore default scrolling
        document.documentElement.style.overflow = 'auto';
      }
    }
    checkZoom();

    window.addEventListener('resize', checkZoom);
    return () => {
      window.removeEventListener('resize', checkZoom);
    };
  }, []);

  // 1) Utility function to rotate an HTMLImageElement by 90° and return a new File
  //    or data URL that you can use for preview/upload.
  const rotateImage90 = (imgElement) => {
    return new Promise((resolve, reject) => {
      try {
        // Because we rotate 90°, the new width = old height, new height = old width
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.height;
        canvas.height = imgElement.width;

        const ctx = canvas.getContext('2d');
        // Translate to (canvas.width, 0) then rotate 90° clockwise
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
        // Draw the image
        ctx.drawImage(imgElement, 0, 0);
        ctx.resetTransform();

        // Option A: convert to Blob and then construct a new File
        canvas.toBlob((blob) => {
          if (!blob) {
            return reject(new Error('Canvas is empty, cannot rotate'));
          }
          // create a File from the Blob
          const rotatedFile = new File([blob], 'rotated_image.jpg', { type: 'image/jpeg' });
          resolve(rotatedFile);
        }, 'image/jpeg', 0.9);

        // Option B (alternative): directly get a data URL
        // const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        // resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // We'll load the raw File into an <img> for dimension checks
    const img = new Image();
    img.onload = async () => {
      const w = img.width;
      const h = img.height;
      const ratio = w / h;
      const epsilon = 0.01;

      const isThreeTwo = Math.abs(ratio - 1.5) < epsilon;   // ~3:2
      const isTwoThree = Math.abs(ratio - 0.6667) < epsilon; // ~2:3

      if (!isThreeTwo && !isTwoThree) {
        setError('Please upload an image with a 3:2 or 2:3 aspect ratio.');
        e.target.value = '';
        return;
      }

      setError(null);

      // If the image is ~2:3, rotate it 90° so that it becomes ~3:2
      // and store the rotated file.
      if (isTwoThree) {
        try {
          const rotatedFile = await rotateImage90(img);
          setImage(rotatedFile);

          // Now load that rotatedFile into a new <img> to get updated preview & dimensions
          const rotatedImg = new Image();
          rotatedImg.onload = () => {
            setLoadedImage(rotatedImg);
            setFullImagePreview(rotatedImg.src);
            setImageSize({ width: rotatedImg.width, height: rotatedImg.height });
            setShowWiggleOptions(false);
          };
          rotatedImg.onerror = () => {
            setError('Failed to display rotated image.');
          };
          rotatedImg.src = URL.createObjectURL(rotatedFile);
        } catch (err) {
          console.error('Rotation failed:', err);
          setError('Rotation failed');
        }
      } else {
        // It's ~3:2 already, no rotation needed
        setImage(file);
        setLoadedImage(img);
        setFullImagePreview(img.src);
        setImageSize({ width: w, height: h });
        setShowWiggleOptions(false);
      }

      setFocalPoints([null, null, null]);
      setIsSplit(false);
    };

    img.onerror = () => {
      setError('Failed to load image.');
      e.target.value = '';
    };

    img.src = URL.createObjectURL(file);
  };

  const handleSplitImage = async () => {
    setFocalPoints([null, null, null]);
    setSplitLoading(true);

    try {
      const img = loadedImage;
      const sectionWidth = Math.floor(img.width / 3);

      const sectionPromises = [0, 1, 2].map(async (i) => {
        const canvas = new OffscreenCanvas(sectionWidth, img.height);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, i * sectionWidth, 0, sectionWidth, img.height, 0, 0, sectionWidth, img.height);
        
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        return URL.createObjectURL(blob);
      });

      const previews = await Promise.all(sectionPromises);
      setImagePreviews(previews);
      setIsSplit(true);
    } catch (err) {
      console.error('Error splitting image:', err);
      setError('Failed to split image');
    } finally {
      setSplitLoading(false);
    }
  };

  const handleSectionClick = (sectionIndex, e) => {
    const rect = e.target.getBoundingClientRect();
    const image = e.target;
    
    const renderedWidth = image.width;
    const renderedHeight = image.height;
    
    const scaleX = image.naturalWidth / renderedWidth;
    const scaleY = image.naturalHeight / renderedHeight;
    
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const containerAspect = renderedWidth / renderedHeight;
    
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    
    if (imageAspect > containerAspect) {
      const actualHeight = renderedWidth / imageAspect;
      const padding = (renderedHeight - actualHeight) / 2;
      y = y - padding;
      y = Math.max(0, Math.min(y, actualHeight));
    } else {
      const actualWidth = renderedHeight * imageAspect;
      const padding = (renderedWidth - actualWidth) / 2;
      x = x - padding;
      x = Math.max(0, Math.min(x, actualWidth));
    }
    
    const originalX = Math.round(x * scaleX);
    const originalY = Math.round(y * scaleY);
    
    const sectionWidth = imageSize.width / 3;
    const adjustedX = originalX + (sectionIndex * sectionWidth);
    
    const finalX = Math.max(
      sectionIndex * sectionWidth,
      Math.min(adjustedX, (sectionIndex + 1) * sectionWidth - 1)
    );
    const finalY = Math.max(0, Math.min(originalY, imageSize.height - 1));
    
    const newFocalPoints = [...focalPoints];
    newFocalPoints[sectionIndex] = { x: finalX, y: finalY };
    setFocalPoints(newFocalPoints);
  };

  // >>> UPDATED handleSubmit to call different endpoints based on 'useSecondFrameAsBackground' <<<
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (focalPoints.some(fp => fp === null)) {
      setError('Please set a focal point on each section before creating wiggle.');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('image', image);
      formData.append('focalPoints', JSON.stringify(focalPoints));
      formData.append('frameSpeed', frameSpeed);
      formData.append('videoLength', videoLength);
      formData.append('useSecondFrameAsBackground', useSecondFrameAsBackground.toString());

      // Decide which endpoint to call.
      // We do /api/process_image_no_rgba if useSecondFrameAsBackground is true,
      // otherwise /api/process_image.
      const endpoint = useSecondFrameAsBackground
        ? 'http://139.162.152.41:8000/api/process_image_no_rgba'
        : 'http://139.162.152.41:8000/api/process_image';

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process image');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wiggle.mp4';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  function handleNext() {
    setShowWiggleOptions(true);
  }

  const handleBack = () => {
    if (showWiggleOptions) {
      setShowWiggleOptions(false);
      return;
    }
    if (isSplit) {
      setIsSplit(false);
    } else if (image) {
      setImage(null);
      setFullImagePreview(null);
      setImagePreviews([]);
      setFocalPoints([null, null, null]);
    }
  };

  const handleRotate180 = async () => {
    try {
      if (!loadedImage) {
        setError('No image loaded.');
        return;
      }

      // Perform a 180° rotation by using a canvas exactly the same size
      const canvas = document.createElement('canvas');
      canvas.width = loadedImage.width;
      canvas.height = loadedImage.height;

      const ctx = canvas.getContext('2d');

      // Move the origin to bottom-right, rotate by 180° (Math.PI)
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);

      // Draw the original image at (0,0), which will appear rotated 180°
      ctx.drawImage(loadedImage, 0, 0);

      ctx.resetTransform();

      // Convert to a Blob, and then a File
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) return reject(new Error('Canvas is empty, cannot rotate by 180.'));
          resolve(b);
        }, 'image/jpeg', 0.9);
      });

      const rotatedFile = new File([blob], 'rotated_180.jpg', { type: 'image/jpeg' });

      // Create a new Image for preview
      const rotatedImg = new Image();
      rotatedImg.onload = () => {
        setLoadedImage(rotatedImg);
        setImage(rotatedFile);
        setFullImagePreview(rotatedImg.src);
        setImageSize({ width: rotatedImg.width, height: rotatedImg.height });
        setError(null);
      };
      rotatedImg.onerror = () => {
        setError('Failed to display 180°-rotated image.');
      };
      rotatedImg.src = URL.createObjectURL(rotatedFile);

    } catch (err) {
      console.error('Rotation by 180° failed:', err);
      setError('Rotation by 180° failed.');
    }
  };

  return (
    <div className="container">
      {(image || isSplit) && (
        <button 
          className="back-arrow" 
          onClick={handleBack}
          title="Go back"
        >
          ←
        </button>
      )}

      {!image && !isSplit && (
        <div
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px 20px',
            boxSizing: 'border-box',
          }}
        >
          <div 
            style={{
              width: '50%',
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: '6em',
                marginBottom: '10px',
                color: '#5e645a',
                fontWeight: 'bold',
                marginTop: '20%'
              }}
            >
              DispoStudio
            </h1>
            <h2
              style={{
                fontSize: '2.5em',
                marginBottom: '10px',
                marginTop: '10px',
                color: '#5e645a',
                fontWeight: 'normal',
              }}
            >
              Wiggle Lens Maker
            </h2>
            <p
              style={{
                lineHeight: '1.5',
                color: '#5e645a',
                marginTop: '20%',
                opacity: '60%',
                fontSize: '28px',
                margin: '20% 20%'
              }}
            >
              Easily create wiggle lens effect videos with your 
              <a 
                href="https://www.etsy.com/uk/shop/DispoStudio"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#5e645a', textDecoration: 'underline', marginLeft: '5px', marginRight: '5px' }}
              >
                Swiss Army Lens
              </a> 
              photos in just a few clicks.
            </p>
          </div>

          <div style={{ width: '50%' }}>
            <div className="upload-container" style={{ textAlign: 'center' }}>
              <label className="upload-label">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload}
                  required 
                  className="upload-input"
                />
                Upload Image
              </label>
            </div>
          </div>
        </div>
      )}

      {!showWiggleOptions && (
        <form onSubmit={handleSubmit} className="upload-form">
          {fullImagePreview && !isSplit && (
            <div className="full-image-container" style={{ display: 'flex', gap: '20px' }}>
              <img 
                src={fullImagePreview} 
                alt="" 
                className="full-image"
              />
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '90%',
                  margin: '0 auto',
                }}
              >
                <button 
                  type="button"
                  onClick={handleRotate180}
                  className="rotate-button"
                  style={{
                    width: '45%',
                    textAlign: 'center',
                    backgroundColor: '#5e645a',
                  }}
                >
                  Rotate 180°
                </button>

                <button 
                  type="button"
                  onClick={handleSplitImage}
                  className="split-button"
                  disabled={splitLoading}
                  style={{
                    width: '45%',
                    textAlign: 'center',
                    backgroundColor: '#5e645a',
                  }}
                >
                  {splitLoading ? 'Splitting...' : 'Split Image'}
                </button>
              </div>
            </div>
          )}

          {isSplit && imagePreviews.length > 0 && (
            <>
              <div className="sections-container">
                {imagePreviews.map((preview, index) => (
                  <div key={index} className="section-card">
                    <div className="section-image-container">
                      <img
                        src={preview}
                        alt={`Section ${index + 1}`}
                        onClick={(e) => handleSectionClick(index, e)}
                        className="section-image"
                      />
                      {focalPoints[index] && (
                        <div
                          className="focal-marker"
                          style={{
                            left: `${(
                              (focalPoints[index].x - index * (imageSize.width / 3)) 
                              / (imageSize.width / 3)
                            ) * 100}%`,
                            top: `${(focalPoints[index].y / imageSize.height) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    {focalPoints[index] && (
                      <div className="coordinates-text">
                        {`Focal point: (${Math.round(focalPoints[index].x - index * (imageSize.width / 3))}, ${Math.round(focalPoints[index].y)})`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {focalPoints.some(fp => fp === null) && (
                <h3 className="previews-title">Click on each section to set focal points:</h3>
              )}
            </>
          )}

          {isSplit && !focalPoints.some(fp => fp === null) && (
            <button
              type="button"
              className="submit-button"
              onClick={handleNext}
            >
              Next
            </button>
          )}
        </form>
      )}

      {showWiggleOptions && (
        <form onSubmit={handleSubmit} className="upload-form" style={{ marginTop: '5%', textAlign: 'center' }}>
          <div style={{ marginBottom: '40px', marginTop: '40px', textAlign: 'center', width: '100%' }}>
            <button
              type="button"
              disabled
              className="split-button"
              style={{
                backgroundColor: '#5e645a',
                cursor: 'default',
                marginBottom: '20px',
                margin: '0 2%',
                width: '25%'
              }}
            >
              Frame Speed:
            </button>

            <div style={{ display: 'inline-block', margin: '0 2%', textAlign: 'center', width: '20%' }}>
              <h3 style={{ margin: '0 0 5px 0', color: '#5e645a' }}>0.1s</h3>
              <button
                type="button"
                className={`frame-button ${frameSpeed === 0.1 ? 'selected-frame' : ''}`}
                onClick={() => setFrameSpeed(0.1)}
              >
                Fast
              </button>
            </div>

            <div style={{ display: 'inline-block', margin: '0 1%', textAlign: 'center', width: '20%' }}>
              <h3 style={{ margin: '0 0 5px 0', color: '#5e645a' }}>0.2s</h3>
              <button
                type="button"
                className={`frame-button ${frameSpeed === 0.2 ? 'selected-frame' : ''}`}
                onClick={() => setFrameSpeed(0.2)}
              >
                Medium
              </button>
            </div>

            <div style={{ display: 'inline-block', margin: '0 1%', textAlign: 'center', width: '20%' }}>
              <h3 style={{ margin: '0 0 5px 0', color: '#5e645a' }}>0.3s</h3>
              <button
                type="button"
                className={`frame-button ${frameSpeed === 0.3 ? 'selected-frame' : ''}`}
                onClick={() => setFrameSpeed(0.3)}
              >
                Slow
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '40px', marginTop: '40px', textAlign: 'center', width: '100%' }}>
            <button
              type="button"
              disabled
              className="split-button"
              style={{
                backgroundColor: '#5e645a',
                cursor: 'default',
                marginBottom: '20px',
                margin: '0 2%',
                width: '30%',
              }}
            >
              Video Length: {parseFloat(videoLength).toPrecision(2)}s
            </button>
            <input
              type="range"
              min="1"
              max="10"
              value={videoLength}
              onChange={(e) => setVideoLength(parseFloat(e.target.value))}
              step={(3 * frameSpeed).toPrecision(1)}
              className="video-slider"
              defaultValue={5}
            />
          </div>

          <div style={{ margin: '30px 0', textAlign: 'center', width: "100%" }}>
            <button
              type="button"
              disabled
              className="split-button"
              style={{
                backgroundColor: '#5e645a',
                cursor: 'default',
                margin: '0 3%',
                width: '50%',
              }}
            >
              Cover background with frame 2:
            </button>
            
            {/* Yes button */}
            <button
              type="button"
              className={`split-button ${useSecondFrameAsBackground ? 'selected-frame' : ''}`}
              style={{ marginRight: '2%', width: '20%' }}
              onClick={() => setUseSecondFrameAsBackground(true)}
              disabled
            >
              Yes
            </button>
            
            {/* No button */}
            <button
              type="button"
              className={`split-button ${!useSecondFrameAsBackground ? 'selected-frame' : ''}`}
              style={{ marginRight: '2%', width: '20%' }}
              onClick={() => setUseSecondFrameAsBackground(false)}
            >
              No
            </button>
          </div>

          <button
            type="submit"
            className="submit-button split-button"
            style={{ marginRight: '2%', width: '80%', textAlign: "center", marginTop: "20%" }}
            disabled={loading}
          >
            {loading ? processingText : 'Export Video'}
          </button>
        </form>
      )}

      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}
    </div>
  );
}

export default App;

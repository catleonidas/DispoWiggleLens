import React, { useState } from 'react';

function App() {
  const [useSecondFrameAsBackground, setUseSecondFrameAsBackground] = useState(false);

  const handleUpload = async () => {
    // Construct form data as usual
    const formData = new FormData();
    formData.append('image', /* your File object here */);
    formData.append('focalPoints', JSON.stringify([
      { x: 1000, y: 1000 },
      { x: 3000, y: 2000 },
      { x: 5000, y: 3000 }
    ]));
    // ... other form fields, e.g. videoLength or frameSpeed
    // If your server still parses useSecondFrameAsBackground:
    formData.append('useSecondFrameAsBackground', useSecondFrameAsBackground.toString());

    // Decide which endpoint to call based on useSecondFrameAsBackground
    const endpoint = useSecondFrameAsBackground
      ? '/api/process_image'        // calls the endpoint that uses RGBA layering
      : '/api/process_image_no_rgba'; // calls the simpler, non-RGBA endpoint

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }
      // Process the returned MP4 file, perhaps as a blob
      const blob = await response.blob();
      // Optionally create a URL to preview or force download
      const videoUrl = URL.createObjectURL(blob);
      // ...
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <div>
      <button
        onClick={() => setUseSecondFrameAsBackground(!useSecondFrameAsBackground)}
      >
        Toggle useSecondFrameAsBackground
      </button>
      <button onClick={handleUpload}>Submit</button>
    </div>
  );
}

export default App; 
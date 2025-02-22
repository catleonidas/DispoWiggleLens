from io import BytesIO
from PIL import Image
from flask import Flask, request, send_file, jsonify, send_from_directory
import json
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
import os
from flask_cors import CORS
import numpy as np
from zipfile import ZipFile
from datetime import datetime
import uuid

app = Flask(__name__, static_folder="build", static_url_path='')
CORS(app)

@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/process_image', methods=['POST'])
def process_image():
    """
    Expects multipart/form-data:
      - "image": an uploaded file (exactly 6000x4000)
      - "focalPoints": JSON array of 3 { x, y } objects
        Example:
        [
          { "x": 1000, "y": 1000 },
          { "x": 3000, "y": 2000 },
          { "x": 5000, "y": 3000 }
        ]
    Creates a "n"s MP4 cycling each of the 3 cropped sections every "n"s.
    Returns MP4 as a binary file in the response.
    """

    cropped_images = []    # Re-initialize for each new request

    # 1) Validate input
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']

    # Parse focal points
    focal_points_str = request.form.get('focalPoints', '[]')
    focal_points = json.loads(focal_points_str)

    # Ensure focal points are integers
    try:
        for fp in focal_points:
            fp["x"] = int(fp["x"])
            fp["y"] = int(fp["y"])
    except (ValueError, TypeError):
        return jsonify({
            "error": "Focal points must be valid integers"
        }), 400

    # New param: if "useSecondFrameAsBackground" param is "true",
    # we'll use a transparent canvas instead of black
    use_second_bg_str = request.form.get('useSecondFrameAsBackground', 'false')
    use_second_bg = (use_second_bg_str.lower() == 'true')

    if len(focal_points) != 3:
        return jsonify({"error": "Exactly 3 focal points are required."}), 400

    # 2) Verify image is 6024x4024
    #    Convert to RGB, just in case it's a different mode.
    image = Image.open(file.stream).convert("RGB")
    width, height = image.size

    EXPECTED_WIDTH = width
    EXPECTED_HEIGHT = height
    check_ratio = width/height
    
    if not (1.4 <= check_ratio <= 1.6):
        return jsonify({
            "error": f"Image must have an aspect ratio between 1.4 and 1.6, got {check_ratio:.2f}"
        }), 400

    # Dimensions for final video
    OUTPUT_WIDTH = EXPECTED_WIDTH//3
    OUTPUT_HEIGHT = EXPECTED_HEIGHT
    SECTION_WIDTH = EXPECTED_WIDTH//3  # The approximate "width" of each sub‐image

    # Parse user-supplied videoLength (seconds) and frameSpeed (seconds per frame)
    video_length_str = request.form.get('videoLength', '5')  # default 5
    frame_speed_str = request.form.get('frameSpeed', '0.1')  # default 0.1
    video_length = float(video_length_str)
    frame_speed = float(frame_speed_str)
    
    # FPS is 1/frameSpeed. For example, frameSpeed=0.1 => fps=10
    fps = 1.0 / frame_speed
    # Total frames is videoLength / frameSpeed. For example, 5s / 0.1s = 50 frames
    total_frames = int(video_length / frame_speed)

    for i, fp in enumerate(focal_points):
        fx, fy = fp["x"], fp["y"]
        
        ################################################################
        # NEW: For all images, always create a fully transparent RGBA canvas
        # of size SECTION_WIDTH x OUTPUT_HEIGHT, centered on (fx, fy).
        ################################################################
        desired_w = SECTION_WIDTH
        desired_h = OUTPUT_HEIGHT
        section_rgba = Image.new("RGBA", (desired_w, desired_h), (0, 0, 0, 0))

        desired_left = fx - (desired_w // 2)
        desired_top  = fy - (desired_h // 2)

        # Figure out portion inside the original image
        source_left   = max(0, desired_left)
        source_top    = max(0, desired_top)
        source_right  = min(EXPECTED_WIDTH,  desired_left + desired_w)
        source_bottom = min(EXPECTED_HEIGHT, desired_top  + desired_h)

        # Crop the valid region and convert to RGBA:
        valid_sub_rgba = image.crop((source_left, source_top, source_right, source_bottom)).convert("RGBA")

        # Where to paste it in our RGBA "section_rgba"
        paste_x = int(source_left - desired_left)
        paste_y = int(source_top  - desired_top)

        # Paste using valid_sub_rgba itself as the mask (which preserves any transparency):
        section_rgba.paste(valid_sub_rgba, (paste_x, paste_y), mask=valid_sub_rgba)

        # Store result
        cropped_images.append(section_rgba)


    frames = []

    for frame_idx in range(total_frames):
        if use_second_bg:
            # Start with a copy of the 2nd cropped image
            frame = cropped_images[1].copy()
        else:
            # Create a new black canvas
            frame = Image.new('RGB', (OUTPUT_WIDTH, OUTPUT_HEIGHT), 'black')
        
        top_image_idx = frame_idx % 3
        
        # Layer the images in order, with the top one last
        for i in range(3):
            img_index = (top_image_idx + i) % 3
            img = cropped_images[img_index]
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            
            # If "useSecondFrameAsBackground" is true, the second image is already
            # the base. We only fade the *other* non-top images on top of it.
            if i < 2 and not (use_second_bg and img_index == 1):
                # Keep partial transparency for non-top images
                img.putalpha(128)   # 50% alpha
            else:
                # The top image is fully opaque, covering lower images
                img.putalpha(255)
            
            if frame.mode == "RGBA":
                frame.paste(img, (0, 0), img)
            else:
                frame.paste(img, (0, 0), img)
        
        frames.append(np.array(frame.convert("RGBA")))

    # Create video clip with the user-selected number of frames & FPS
    clip = ImageSequenceClip(frames, fps=fps)

    del frames

    # Generate a unique random filename
    temp_filename = f"temp_video_{uuid.uuid4()}.mp4"

    # 5) Write the clip to an in-memory buffer as an MP4
    video_bytes = BytesIO()
    clip.write_videofile(
        temp_filename,
        codec="libx264",
        fps=fps,
        audio=False,
        logger=None,
        threads=1
    )

    # Read the file into memory
    with open(temp_filename, "rb") as f:
        video_bytes_data = f.read()

    # Optionally remove the temp file
    os.remove(temp_filename)

    # 6) Return the MP4 in the response
    # Option A: Return as direct file download with correct MIME type
    return send_file(
        BytesIO(video_bytes_data),
        mimetype="video/mp4",
        as_attachment=True,
        download_name="output.mp4"
    )

@app.route('/api/process_image_no_rgba', methods=['POST'])
def process_image_no_rgba():
    """
    Same overall logic, but implemented without using a large RGBA canvas
    for intermediate cropping or compositing.
    """

    
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']

    # Parse focal points
    focal_points_str = request.form.get('focalPoints', '[]')
    focal_points = json.loads(focal_points_str)

    # Ensure focal points are integers
    try:
        for fp in focal_points:
            fp["x"] = int(fp["x"])
            fp["y"] = int(fp["y"])
    except (ValueError, TypeError):
        return jsonify({
            "error": "Focal points must be valid integers"
        }), 400


    # New param: if "useSecondFrameAsBackground" param is "true",
    # we'll use the second cropped sub-image as our background.
    use_second_bg_str = request.form.get('useSecondFrameAsBackground', 'false')
    use_second_bg = (use_second_bg_str.lower() == 'true')

    if len(focal_points) != 3:
        return jsonify({"error": "Exactly 3 focal points are required."}), 400

    # 2) Verify image is 6000x4000
    image = Image.open(file.stream).convert("RGBA")
    width, height = image.size
    EXPECTED_WIDTH = width
    EXPECTED_HEIGHT = height
    check_ratio = width/height
    if not (1.4 <= check_ratio <= 1.6):
        return jsonify({
            "error": f"Image must have an aspect ratio between 1.4 and 1.6, got {check_ratio:.2f}"
        }), 400

    # Dimensions for final video
    OUTPUT_WIDTH = EXPECTED_WIDTH//3
    OUTPUT_HEIGHT = EXPECTED_HEIGHT
    SECTION_WIDTH = EXPECTED_WIDTH//3  # The approximate "width" of each sub‐image

    # Parse user-supplied videoLength (seconds) and frameSpeed (seconds per frame)
    video_length_str = request.form.get('videoLength', '5')  # default 5
    frame_speed_str = request.form.get('frameSpeed', '0.1')  # default 0.1
    video_length = float(video_length_str)
    frame_speed = float(frame_speed_str)
    fps = 1.0 / frame_speed
    total_frames = int(video_length / frame_speed)

    # 3) For each focal point, crop a sub‐image (just in RGB)
    cropped_images = []
    for i,fp in enumerate(focal_points):
        fx, fy = fp["x"], fp["y"]
        # Center the sub‐image around (fx, fy), width=SECTION_WIDTH, height=OUTPUT_HEIGHT
        desired_w = SECTION_WIDTH
        desired_h = OUTPUT_HEIGHT
        desired_left = fx - (desired_w // 2)
        desired_top  = fy - (desired_h // 2)

        # Clamp to valid region
        source_left   = max(0 + SECTION_WIDTH*i, desired_left)
        source_top    = max(0, desired_top)
        source_right  = min(SECTION_WIDTH*(i+1),  desired_left + desired_w)
        source_bottom = min(EXPECTED_HEIGHT, desired_top  + desired_h)

        if i == 1:
            valid_sub = image.crop((SECTION_WIDTH*i, 0, SECTION_WIDTH*(i+1), EXPECTED_HEIGHT))
            cropped_images.append(valid_sub)

        else:

            valid_sub = image.crop((source_left, source_top, source_right, source_bottom))
            cropped_images.append(valid_sub)
        #valid_sub.save(f"cropped_{len(cropped_images)}.png")  # Simple numbered files in current directory


    # 4) Compose frames for the video (no RGBA; just plain RGB)
    frames = []
    for frame_idx in range(total_frames):
        # Decide which image is on top
        top_image_idx = frame_idx % 3

        if use_second_bg:
            # Start with the second sub-image as background
            base_img = cropped_images[1].copy()
            # We'll paste it into a 3000x4000 black canvas so final size is consistent
            frame = Image.new("RGBA", (OUTPUT_WIDTH, OUTPUT_HEIGHT), "black")
            # Center base_img on the black canvas
            base_offset_x = (OUTPUT_WIDTH - base_img.width) // 2
            base_offset_y = (OUTPUT_HEIGHT - base_img.height) // 2
            frame.paste(base_img, (base_offset_x, base_offset_y))
        else:
            # Create a new black background of 3000x4000
            frame = Image.new("RGBA", (OUTPUT_WIDTH, OUTPUT_HEIGHT), "black")

        # Paste the "top" image last, adjusting offset_x depending on the top_image_idx
        top_img = cropped_images[top_image_idx]

        if top_image_idx == 1:
            offset_y = 0
        else:
            offset_y = max(focal_points[1]["y"] - OUTPUT_HEIGHT//2,focal_points[1]["y"] - focal_points[top_image_idx]["y"])

        if top_image_idx == 1:
            offset_x = 0
        else:
            offset_x = max(focal_points[1]["x"]%OUTPUT_WIDTH - OUTPUT_WIDTH//2, focal_points[1]["x"]%OUTPUT_WIDTH - focal_points[top_image_idx]["x"]%OUTPUT_WIDTH)

        frame.paste(top_img, (offset_x, offset_y))

        # Convert to numpy array for moviepy
        frames.append(np.array(frame))

    # 5) Create video clip and write to MP4 in-memory
    clip = ImageSequenceClip(frames, fps=fps)

    del frames

    # Generate a unique random filename
    temp_filename = f"temp_video_no_rgba_{uuid.uuid4()}.mp4"

    video_bytes = BytesIO()
    clip.write_videofile(
        temp_filename,
        codec="libx264",
        fps=fps,
        audio=False,
        logger=None,
        threads=1
    )

    with open(temp_filename, "rb") as f:
        video_bytes_data = f.read()

    os.remove(temp_filename)

    # 6) Return the MP4
    return send_file(
        BytesIO(video_bytes_data),
        mimetype="video/mp4",
        as_attachment=True,
        download_name="output_no_rgba.mp4"
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)

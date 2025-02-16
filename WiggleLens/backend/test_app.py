import unittest
from app import app
import json
import io

class TestApp(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_process_image_no_image(self):
        # Test when no image is provided
        response = self.app.post('/api/process_image')
        self.assertEqual(response.status_code, 400)
        self.assertIn('No image file provided', response.json['error'])

    def test_process_image_wrong_focal_points(self):
        # Test with wrong number of focal points
        data = {
            'image': (io.BytesIO(b'fake image data'), 'test.jpg'),
            'focalPoints': json.dumps([
                {"x": 1000, "y": 1000},
                {"x": 2000, "y": 2000}  # Only 2 points instead of 3
            ])
        }
        response = self.app.post('/api/process_image', data=data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('3 focal points', response.json['error'])

    def test_process_image_wrong_dimensions(self):
        # Test with wrong image dimensions
        # Create a small test image in memory
        test_image = io.BytesIO()
        from PIL import Image
        Image.new('RGB', (100, 100)).save(test_image, 'JPEG')
        test_image.seek(0)
        
        data = {
            'image': (test_image, 'test.jpg'),
            'focalPoints': json.dumps([
                {"x": 1000, "y": 1000},
                {"x": 2000, "y": 2000},
                {"x": 3000, "y": 3000}
            ])
        }
        response = self.app.post('/api/process_image', data=data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('6000x4000', response.json['error'])

if __name__ == '__main__':
    unittest.main() 
# Random Three Photos

A Python script that randomly selects 3 photos from your collection and applies advanced randomization techniques to create unique variations while preserving the original files.

## Overview

This script combines functionality from `randomiser.py` and `organize_pictures.py` to create a streamlined photo randomization tool that:
- Selects 3 random photos from the `allpictures` folder
- Applies sophisticated image processing techniques
- Saves the results to a `DONE` folder
- **Never deletes or modifies your original photos**

## Features

### Photo Selection
- Randomly picks 3 photos from your `allpictures` collection
- Supports multiple formats: HEIC, PNG, JPEG, JPG, WebP, BMP
- Ensures you always have fresh combinations

### Advanced Randomization Techniques
The script applies multiple layers of image modifications:

1. **Geometric Transformations**
   - Random scaling (85%-115% of original size)
   - Subtle rotation (-5° to +5°)
   - Smart cropping with random padding
   - Optional horizontal mirroring

2. **Color Adjustments**
   - Brightness variations (very subtle)
   - Contrast modifications
   - Saturation adjustments
   - Gamma correction
   - Color enhancement

3. **Noise and Distortion**
   - Multi-layer noise addition (Gaussian, salt-and-pepper, Poisson)
   - Advanced local distortion with sinusoidal waves
   - Invisible watermarking using LSB modification
   - High-frequency noise injection

4. **Filtering Effects**
   - Random application of 3 filters per image
   - Available filters: blur, unsharp mask, detail, smooth, sharpen
   - Gaussian blur with variable radius
   - Unsharp mask with random parameters

5. **Compression Simulation**
   - JPEG artifacts simulation
   - Variable quality levels (75-95%)
   - Progressive encoding options

6. **Final Processing**
   - Random final dimensions (2000-4000px width)
   - Complete metadata removal
   - Unique filename generation

## Usage

### Prerequisites
Install required Python packages:
```bash
pip install pillow pillow-heif numpy opencv-python
```

### Running the Script
1. Place your photos in the `allpictures` folder
2. Run the script:
```bash
python random_three.py
```

### Output
- Creates a `DONE` folder if it doesn't exist
- Generates 3 randomized photos with unique filenames
- Original photos remain untouched in `allpictures`
- Each output filename includes random strings and hash for uniqueness

## File Structure
```
your-directory/
├── allpictures/          # Your original photo collection
│   ├── IMG_001.HEIC
│   ├── IMG_002.jpg
│   └── ...
├── DONE/                 # Generated randomized photos
│   ├── AbCdEf123456_a1b2c3d4.jpg
│   ├── XyZ789012345_e5f6g7h8.jpg
│   └── ...
├── random_three.py       # This script
└── README.md            # This documentation
```

## Key Differences from Original Scripts

### vs. randomiser.py
- **Photo Count**: Processes only 3 photos instead of 20-25
- **Source Preservation**: Never deletes original photos
- **Single Run**: One randomization per execution, not batch processing
- **Simplified Output**: Direct to DONE folder, no complex folder structures

### vs. organize_pictures.py
- **No Moving**: Copies photos instead of moving them
- **Processing**: Applies randomization instead of just organizing
- **Selection**: Random selection instead of sequential processing

## Technical Details

### Anti-Detection Features
The script implements advanced techniques to make each output unique:
- Pixel-level modifications that are invisible to the human eye
- Metadata stripping to remove identifying information
- Multiple layers of subtle transformations
- Randomized processing parameters for each image

### Performance
- Optimized for single-run execution
- Memory-efficient image loading
- Fast processing with minimal quality loss
- Unique filename generation prevents conflicts

## Safety Features
- **Non-destructive**: Original photos are never modified or deleted
- **Error handling**: Continues processing if one image fails
- **Validation**: Checks folder existence and image count before processing
- **Feedback**: Detailed progress reporting and error messages

## Example Output
```
============================================================
RANDOMISATION DE 3 PHOTOS ALÉATOIRES
============================================================
Dossier DONE créé: DONE
Photos sélectionnées: ['IMG_2355.HEIC', 'IMG_4523.HEIC', 'IMG_9044.jpg']

Début de la randomisation de 3 photos...
Traitement de l'image 1/3: IMG_2355.HEIC
  ✓ Image 1 traitée avec succès
Traitement de l'image 2/3: IMG_4523.HEIC
  ✓ Image 2 traitée avec succès
Traitement de l'image 3/3: IMG_9044.jpg
  ✓ Image 3 traitée avec succès

============================================================
TRAITEMENT TERMINÉ
============================================================
Photos traitées avec succès: 3/3
Temps de traitement: 2.34 secondes
Photos sauvegardées dans: DONE/
Photos originales conservées dans: allpictures/
============================================================
```

## Troubleshooting

### Common Issues
- **"pillow-heif not installed"**: Install with `pip install pillow-heif` for HEIC support
- **"Folder not found"**: Ensure `allpictures` folder exists with images
- **"Not enough images"**: Need at least 3 images in `allpictures` folder
- **OpenCV errors**: Install with `pip install opencv-python`

### Requirements
- Python 3.6+
- PIL/Pillow
- NumPy
- OpenCV-Python
- pillow-heif (for HEIC files)
#!/usr/bin/python3
# -*- coding: utf-8 -*-

import sys
import os
import os.path
import faulthandler

faulthandler.enable()

# Set UTF-8 encoding for Windows compatibility
if os.name == 'nt':  # Windows
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import string
import random
import PIL
from PIL import Image, ImageFilter, ImageOps
import numpy as np
from PIL import ImageEnhance
import math
import hashlib
import time
from io import BytesIO
import subprocess
import tempfile
import cv2
import json
import piexif
from metadata_spoofer import (
    generate_spoofed_metadata,
    convert_decimal_to_dms,
    parse_fraction_to_tuple,
    generate_random_filename,
)

# Output format (default HEIC/HEIF to mimic iPhone originals).
DESIRED_OUTPUT_FORMAT = "HEIF"
DEFAULT_FALLBACK_FORMAT = "JPEG"
OUTPUT_FORMAT = DESIRED_OUTPUT_FORMAT
OUTPUT_EXTENSION = ".HEIC"
HEIC_SUPPORTED = True

# Pour supporter les fichiers HEIC
try:
    from pillow_heif import register_heif_opener, load_libheif_plugin
except ImportError:
    def register_heif_opener():
        print("pillow-heif n'est pas installé. Les fichiers HEIC ne seront pas convertis.")
    def load_libheif_plugin():
        print("pillow-heif n'est pas installé. Les fichiers HEIC ne seront pas convertis.")

def ensure_done_directory(custom_path=None):
    """Crée le dossier de sortie s'il n'existe pas"""
    done_path = custom_path if custom_path else "DONE"
    if not os.path.exists(done_path):
        os.makedirs(done_path)
        print(f"Dossier de sortie créé: {done_path}")
    return done_path

def create_iphone_exif(img_width, img_height):
    """Generate EXIF metadata aligned with iphone_exif_gui_reconstructed output."""
    metadata = generate_spoofed_metadata()
    camera = metadata["camera"]
    location = metadata["location"]
    dates = metadata["dates"]
    iphone_model = metadata["iphone_model"]
    iso_value = metadata["iso"]

    lat_ref = location["GPSLatitudeRef"]
    lon_ref = location["GPSLongitudeRef"]
    lat_deg = convert_decimal_to_dms(location["LatitudeDecimal"])
    lon_deg = convert_decimal_to_dms(location["LongitudeDecimal"])

    gps_time_parts = location["GPSTimeStamp"].split(":")
    gps_seconds = float(gps_time_parts[2])
    gps_timestamp = (
        (int(gps_time_parts[0]), 1),
        (int(gps_time_parts[1]), 1),
        (int(gps_seconds * 1000), 1000),
    )

    exposure_time_tuple = camera["ExposureTimeTuple"]
    focal_length_value = camera["FocalLengthValue"]
    aperture_value = camera["FNumber"]

    brightness_tuple = (
        int(float(camera["BrightnessValue"]) * 100),
        100,
    )
    aperture_value_tuple = (
        int(float(camera["ApertureValue"]) * 100),
        100,
    )
    max_aperture_tuple = (
        int(float(camera["MaxApertureValue"]) * 100),
        100,
    )
    shutter_speed_tuple = (
        int(float(camera["ShutterSpeedValue"]) * 100),
        100,
    )
    digital_zoom_tuple = (
        int(float(camera["DigitalZoomRatio"]) * 100),
        100,
    )

    live_photo_flag = random.random() > 0.55
    portrait_flag = random.random() > 0.5
    scene_capture_value = int(camera["SceneCaptureType"])
    if portrait_flag:
        scene_capture_value = 2  # Portrait-like hint
    custom_rendered_value = 3 if live_photo_flag else 1  # Multi-frame / custom processing hint
    image_unique_id = hashlib.md5(os.urandom(32)).hexdigest()
    user_comment = f"iOS {'Live Photo' if live_photo_flag else 'Portrait' if portrait_flag else 'Photo'}"
    user_comment_bytes = b"ASCII\x00\x00\x00" + user_comment.encode("ascii", errors="ignore")
    scene_type_value = b"\x01"  # Directly set to 1 as a byte per EXIF spec

    gps_altitude = (
        int(float(location["AltitudeMeters"]) * 100),
        100,
    )
    gps_dop = (
        int(float(location["GPSDOP"]) * 100),
        100,
    )
    gps_version = tuple(int(part) for part in location["GPSVersionID"].split("."))

    exif_ifd = {
        piexif.ExifIFD.DateTimeOriginal: dates["DateTimeOriginal"],
        piexif.ExifIFD.DateTimeDigitized: dates["DateTimeDigitized"],
        piexif.ExifIFD.SubSecTime: dates["SubSecTime"],
        piexif.ExifIFD.SubSecTimeOriginal: dates["SubSecTimeOriginal"],
        piexif.ExifIFD.SubSecTimeDigitized: dates["SubSecTimeDigitized"],
        piexif.ExifIFD.OffsetTime: camera["OffsetTime"],
        piexif.ExifIFD.OffsetTimeOriginal: camera["OffsetTimeOriginal"],
        piexif.ExifIFD.OffsetTimeDigitized: camera["OffsetTimeDigitized"],
        piexif.ExifIFD.LensMake: camera["LensMake"].encode("utf-8"),
        piexif.ExifIFD.LensModel: camera["LensModel"].encode("utf-8"),
        piexif.ExifIFD.LensSerialNumber: camera["LensSerialNumber"].encode("utf-8"),
        piexif.ExifIFD.BodySerialNumber: camera["SerialNumber"].encode("utf-8"),
        piexif.ExifIFD.FNumber: (int(aperture_value * 100), 100),
        piexif.ExifIFD.ApertureValue: aperture_value_tuple,
        piexif.ExifIFD.MaxApertureValue: max_aperture_tuple,
        piexif.ExifIFD.ExposureTime: exposure_time_tuple,
        piexif.ExifIFD.ShutterSpeedValue: shutter_speed_tuple,
        piexif.ExifIFD.ISOSpeedRatings: iso_value,
        piexif.ExifIFD.FocalLength: (int(focal_length_value * 100), 100),
        piexif.ExifIFD.FocalLengthIn35mmFilm: camera["FocalLengthIn35mmFormat"],
        piexif.ExifIFD.ExposureProgram: int(camera["ExposureProgram"]),
        piexif.ExifIFD.ExposureMode: int(camera["ExposureMode"]),
        piexif.ExifIFD.ExposureBiasValue: parse_fraction_to_tuple(camera["ExposureCompensation"]),
        piexif.ExifIFD.BrightnessValue: brightness_tuple,
        piexif.ExifIFD.MeteringMode: int(camera["MeteringMode"]),
        piexif.ExifIFD.WhiteBalance: int(camera["WhiteBalance"]),
        piexif.ExifIFD.ColorSpace: int(camera["ColorSpace"]),
        piexif.ExifIFD.Flash: int(camera["Flash"]),
        piexif.ExifIFD.DigitalZoomRatio: digital_zoom_tuple,
        piexif.ExifIFD.Saturation: int(camera["Saturation"]),
        piexif.ExifIFD.Contrast: int(camera["Contrast"]),
        piexif.ExifIFD.Sharpness: int(camera["Sharpness"]),
        piexif.ExifIFD.PixelXDimension: img_width,
        piexif.ExifIFD.PixelYDimension: img_height,
        piexif.ExifIFD.ExifVersion: camera["ExifVersion"].encode("ascii"),
        piexif.ExifIFD.FlashpixVersion: camera["FlashpixVersion"].encode("ascii"),
        piexif.ExifIFD.ComponentsConfiguration: camera["ComponentsConfiguration"].encode("ascii"),
        piexif.ExifIFD.SceneCaptureType: scene_capture_value,
        piexif.ExifIFD.CustomRendered: custom_rendered_value,
        piexif.ExifIFD.SceneType: scene_type_value,
        piexif.ExifIFD.ImageUniqueID: image_unique_id,
        piexif.ExifIFD.UserComment: user_comment_bytes,
    }

    zeroth_ifd = {
        piexif.ImageIFD.Make: camera["Make"].encode("utf-8"),
        piexif.ImageIFD.Model: iphone_model.encode("utf-8"),
        piexif.ImageIFD.Orientation: 1,
        piexif.ImageIFD.XResolution: (72, 1),
        piexif.ImageIFD.YResolution: (72, 1),
        piexif.ImageIFD.ResolutionUnit: 2,
        piexif.ImageIFD.Software: camera["Software"].encode("utf-8"),
        piexif.ImageIFD.DateTime: dates["ModifyDate"],
        piexif.ImageIFD.YCbCrPositioning: int(camera["YCbCrPositioning"]),
    }

    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: lat_ref.encode("utf-8"),
        piexif.GPSIFD.GPSLatitude: lat_deg,
        piexif.GPSIFD.GPSLongitudeRef: lon_ref.encode("utf-8"),
        piexif.GPSIFD.GPSLongitude: lon_deg,
        piexif.GPSIFD.GPSAltitudeRef: 0,
        piexif.GPSIFD.GPSAltitude: gps_altitude,
        piexif.GPSIFD.GPSTimeStamp: gps_timestamp,
        piexif.GPSIFD.GPSDateStamp: location["GPSDateStamp"],
        piexif.GPSIFD.GPSSatellites: location["GPSSatellites"].encode("utf-8"),
        piexif.GPSIFD.GPSStatus: location["GPSStatus"].encode("utf-8"),
        piexif.GPSIFD.GPSMeasureMode: location["GPSMeasureMode"].encode("utf-8"),
        piexif.GPSIFD.GPSDOP: gps_dop,
        piexif.GPSIFD.GPSMapDatum: location["GPSMapDatum"].encode("utf-8"),
        piexif.GPSIFD.GPSVersionID: gps_version,
    }

    exif_dict = {"0th": zeroth_ifd, "Exif": exif_ifd, "GPS": gps_ifd}
    exif_bytes = piexif.dump(exif_dict)

    print(f"  [EXIF] 📷 Back Camera - {iphone_model}, {camera['Software']}")
    print(f"  [EXIF] {camera['LensModel']}")
    print(
        f"  [EXIF] ISO {iso_value}, f/{aperture_value}, {camera['ExposureTime']}s, "
        f"{camera['FocalLengthIn35mmFormat']}mm"
    )
    print(f"  [EXIF] Date: {dates['DateTimeOriginal']}")
    print(f"  [EXIF] GPS: {location['GPSPosition']}")
    mode_label = "Live" if live_photo_flag else "Portrait" if portrait_flag else "Photo"
    print(f"  [EXIF] Mode: {mode_label} | ID: {image_unique_id[:12]}...")

    return exif_bytes

def get_random_string(length):
    """Génère une chaîne aléatoire unique"""
    letters = string.ascii_letters + string.digits 
    result_str = ''.join(random.choice(letters) for i in range(length))
    # Ajouter un timestamp pour garantir l'unicité
    timestamp = str(int(time.time() * 1000000))[-6:]
    return result_str + timestamp

def add_advanced_noise(img, intensity=3):
    """Ultra-fast multi-layer noise - heavily optimized"""
    if intensity < 1:
        return img
        
    arr = np.array(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    
    # Convert to int16 once to prevent overflow
    arr_work = arr.astype(np.int16)
    
    # 1. Fast Gaussian noise - generate directly at correct size
    if intensity > 0:
        # Generate noise directly at the target size to avoid resize issues
        gaussian_noise = np.random.normal(0, intensity * 0.3, (h, w, 3)).astype(np.int8)
        arr_work += gaussian_noise
    
    # 2. Ultra-fast salt-and-pepper (vectorized) - much more subtle
    if intensity > 2:  # Only apply for higher intensity
        salt_pepper_ratio = 0.00005 * (intensity / 3)  # Much smaller ratio
        mask_size = int(salt_pepper_ratio * h * w)
        if mask_size > 0:
            # Generate random coordinates in one go
            flat_indices = np.random.choice(h * w, mask_size, replace=False)
            y_coords, x_coords = np.divmod(flat_indices, w)
            # Use more subtle values instead of pure black/white
            values = np.random.choice([10, 245], mask_size)  # Much more subtle than 0/255
            arr_work[y_coords, x_coords] = values[:, np.newaxis]
    
    # 3. Fast Poisson-like noise - generate directly at correct size
    if intensity > 2:  # Only for higher intensity
        # Generate noise directly at the target size to avoid resize issues
        poisson_noise = np.random.uniform(-intensity*0.05, intensity*0.05, (h, w, 3)).astype(np.int8)
        arr_work += poisson_noise
    
    # Single clip operation at the end
    arr_final = np.clip(arr_work, 0, 255).astype(np.uint8)
    return Image.fromarray(arr_final)

def random_color_aggressive(img):
    """No-op color step to avoid unwanted shifts (kept for pipeline compatibility)."""
    return img

def random_gamma_correction(img):
    """No-op gamma step to avoid unwanted tonal shifts."""
    return img

def advanced_local_distortion(img, amplitude=3):
    """Distorsion locale avancée - déforme subtilement l'image"""
    arr = np.array(img)
    h, w = arr.shape[:2]
    
    # Créer une grille de déformation
    grid_size = 20
    grid_points = []
    for y in range(0, h, h // grid_size):
        for x in range(0, w, w // grid_size):
            dx = random.randint(-amplitude, amplitude)
            dy = random.randint(-amplitude, amplitude)
            grid_points.append((x + dx, y + dy))
    
    # Appliquer une déformation sinusoïdale
    for y in range(h):
        wave = int(amplitude * math.sin(2 * math.pi * y / h * random.uniform(2, 4)))
        if arr.ndim == 3:
            arr[y] = np.roll(arr[y], wave, axis=0)
    
    return Image.fromarray(arr)

def apply_random_filter(img):
    """Applique 3 filtres aléatoires avec probabilités équilibrées"""
    filter_types = ['blur', 'unsharp', 'detail', 'smooth', 'smooth_more', 'sharpen']
    
    # Appliquer exactement 3 filtres aléatoires
    selected_filters = random.sample(filter_types, 3)
    
    for filter_type in selected_filters:
        if filter_type == 'blur':
            filter_to_apply = ImageFilter.GaussianBlur(radius=random.uniform(0.1, 0.5))
        elif filter_type == 'unsharp':
            filter_to_apply = ImageFilter.UnsharpMask(radius=random.uniform(0.5, 1.5), percent=random.randint(100, 200))
        elif filter_type == 'detail':
            filter_to_apply = ImageFilter.DETAIL
        elif filter_type == 'smooth':
            filter_to_apply = ImageFilter.SMOOTH
        elif filter_type == 'smooth_more':
            filter_to_apply = ImageFilter.SMOOTH_MORE
        else:  # sharpen
            filter_to_apply = ImageFilter.SHARPEN
        
        img = img.filter(filter_to_apply)
    
    return img

def add_invisible_watermark(img):
    """Ultra-fast invisible watermark with full functionality - FIXED"""
    arr = np.array(img, dtype=np.uint8)
    h, w = arr.shape[:2]
    
    # 1. Fast LSB modification (vectorized) - FIXED shape matching
    # Calculate exact dimensions for sliced array
    slice_h = len(range(0, h, 2))  # Actual height after [::2] slicing
    slice_w = len(range(0, w, 2))  # Actual width after [::2] slicing
    
    # Create mask with exact dimensions
    mask = np.random.randint(0, 2, (slice_h, slice_w, 3), dtype=np.uint8)
    
    # Apply mask to sliced array (now guaranteed to match)
    arr[::2, ::2, :] = arr[::2, ::2, :] ^ mask
    
    # 2. Fast high-frequency noise (simplified) - FIXED resize issues
    # Generate at 1/4 resolution
    freq_h, freq_w = max(h//4, 10), max(w//4, 10)
    freq_noise = (np.random.rand(freq_h, freq_w, 3) * 2 - 1).astype(np.float32)
    freq_noise *= random.uniform(0.1, 0.2)  # Much more subtle
    
    # Resize with exact dimensions specified
    freq_resized = cv2.resize(freq_noise, (w, h), interpolation=cv2.INTER_LINEAR)
    
    # Apply noise with safe addition
    arr_float = arr.astype(np.float32)
    arr_float += freq_resized
    arr_final = np.clip(arr_float, 0, 255).astype(np.uint8)
    
    return Image.fromarray(arr_final)

def apply_radial_sharpness_falloff(img, falloff_strength=0.35):
    """Blend original with a blurred copy to mimic lens edge softness."""
    arr = np.array(img, dtype=np.float32)
    h, w = arr.shape[:2]
    sigma = max(1.1, min(h, w) / 900 * 2.5)
    blurred = cv2.GaussianBlur(arr, (0, 0), sigmaX=sigma, sigmaY=sigma)

    yy, xx = np.ogrid[:h, :w]
    cy, cx = h / 2.0, w / 2.0
    dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    norm = dist / (dist.max() + 1e-6)
    mask = np.clip((norm ** 1.6) * falloff_strength, 0.0, 1.0)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=1.2)  # Smooth transition
    mask = mask[..., None]

    blended = arr * (1.0 - mask) + blurred * mask
    blended = np.clip(blended, 0, 255).astype(np.uint8)
    return Image.fromarray(blended)

def generate_prnu_pattern(width, height, base_strength=0.003):
    """Generate an iPhone-like PRNU map (per-image unique) on luminance, very low amplitude."""
    # Avoid np.random.randint upper-bound issues on some platforms (int32 limits)
    entropy = int.from_bytes(os.urandom(8), "little")
    seed = int(time.time() * 1000000) ^ random.getrandbits(63) ^ entropy
    rng = np.random.default_rng(seed)

    raw = rng.normal(0, 1.0, (height, width)).astype(np.float32)
    high_freq = raw - cv2.GaussianBlur(raw, (0, 0), sigmaX=2.2)

    row_stripes = rng.normal(0, 0.35, (height, 1)).astype(np.float32)
    col_stripes = rng.normal(0, 0.35, (1, width)).astype(np.float32)
    high_freq += 0.12 * row_stripes + 0.12 * col_stripes

    yy, xx = np.mgrid[:height, :width]
    cfa_phase = ((xx % 2) ^ (yy % 2)).astype(np.float32) - 0.5
    high_freq += cfa_phase * rng.uniform(0.02, 0.05)

    cy, cx = height / 2.0, width / 2.0
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    norm_r = radius / (radius.max() + 1e-6)
    radial = 1.0 - 0.25 * (norm_r ** 1.3)
    radial = np.clip(radial, 0.72, 1.0)

    pattern = high_freq * radial
    pattern /= (np.max(np.abs(pattern)) + 1e-6)
    strength = rng.uniform(base_strength * 0.6, base_strength * 1.4)
    return pattern * strength

def apply_prnu_spoofing(img, base_strength=0.003):
    """Inject a sensor-like PRNU residual (luminance-only, ultra low strength) with blending."""
    arr_uint8 = np.array(img, dtype=np.uint8)
    h, w = arr_uint8.shape[:2]
    ycc = cv2.cvtColor(arr_uint8, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    y_plane = ycc[:, :, 0]
    try:
        prnu_pattern = generate_prnu_pattern(w, h, base_strength)
    except ValueError as e:
        print(f"⚠️  PRNU skipped (seed error): {e}")
        return img
    prnu_pattern = np.clip(prnu_pattern, -0.004, 0.004)
    perturbed = np.clip(y_plane * (1.0 + prnu_pattern), 0, 255)
    # Blend with original to keep tonal stability
    blended_y = 0.7 * y_plane + 0.3 * perturbed
    ycc[:, :, 0] = blended_y
    rgb = cv2.cvtColor(np.clip(ycc, 0, 255).astype(np.uint8), cv2.COLOR_YCrCb2RGB)
    return Image.fromarray(rgb, 'RGB')

def modify_dct_coefficients(img, jitter_strength=0.12, block_size=8):
    """Adjust mid/high DCT coefficients block-by-block to alter JPEG fingerprints (luminance only, mild)."""
    arr_uint8 = np.array(img, dtype=np.uint8)
    ycc = cv2.cvtColor(arr_uint8, cv2.COLOR_RGB2YCrCb).astype(np.float32)
    y_channel = ycc[:, :, 0]

    h, w = y_channel.shape
    pad_h = (block_size - (h % block_size)) % block_size
    pad_w = (block_size - (w % block_size)) % block_size
    padded = cv2.copyMakeBorder(y_channel, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT_101)

    rng = np.random.default_rng(int(time.time() * 1000000) ^ random.getrandbits(32))
    mask = np.fromfunction(lambda i, j: (i + j) >= 3, (block_size, block_size)).astype(np.float32)

    for y in range(0, padded.shape[0], block_size):
        for x in range(0, padded.shape[1], block_size):
            block = padded[y:y + block_size, x:x + block_size]
            dct_block = cv2.dct(block)
            energy = max(np.std(dct_block[1:, 1:]), 1.0)
            noise_scale = energy * 0.015 * jitter_strength
            noise = rng.normal(0, noise_scale, dct_block.shape).astype(np.float32)
            dct_block += noise * mask
            dct_block[0, 0] = block.mean()  # Preserve DC component stability
            padded[y:y + block_size, x:x + block_size] = cv2.idct(dct_block)

    modified = padded[:h, :w]
    blended = 0.7 * y_channel[:h, :w] + 0.3 * np.clip(modified, 0, 255)
    ycc[:h, :w, 0] = blended
    rgb = cv2.cvtColor(np.clip(ycc, 0, 255).astype(np.uint8), cv2.COLOR_YCrCb2RGB)
    return Image.fromarray(rgb, 'RGB')

def apply_lsb_randomization_and_microshift(img, lsb_ratio=0.35, shift_ratio=0.15):
    """Randomize LSBs and micro-shift ~15% pixels by ±1px."""
    arr = np.array(img, dtype=np.uint8)
    h, w = arr.shape[:2]

    entropy = int.from_bytes(os.urandom(8), "little")
    rng = np.random.default_rng(int(time.time() * 1000000) ^ random.getrandbits(63) ^ entropy)

    lsb_mask = rng.random((h, w)) < lsb_ratio
    random_bits = rng.integers(0, 2, (h, w, 3), dtype=np.uint8)
    arr = np.where(lsb_mask[..., None], (arr & 0xFE) | random_bits, arr)

    total_pixels = h * w
    shift_pixels = max(1, int(total_pixels * shift_ratio))
    chosen = rng.choice(total_pixels, size=shift_pixels, replace=False)
    ys, xs = np.divmod(chosen, w)
    dx = rng.choice([-1, 1], size=shift_pixels)
    dy = rng.choice([-1, 1], size=shift_pixels)

    src_x = np.clip(xs + dx, 0, w - 1)
    src_y = np.clip(ys + dy, 0, h - 1)

    shifted = arr.copy()
    shifted[ys, xs] = arr[src_y, src_x]
    return Image.fromarray(shifted, 'RGB')

def random_jpeg_artifacts(img):
    """Simule différents niveaux de compression JPEG"""
    # Sauvegarder temporairement avec compression aléatoire
    buffer = BytesIO()
    quality = random.randint(75, 95)
    img.save(buffer, format='JPEG', quality=quality, optimize=False)
    buffer.seek(0)
    return Image.open(buffer).convert('RGB')

def smart_crop_and_pad(img):
    """Recadrage intelligent avec padding aléatoire plus varié"""
    width, height = img.size
    
    # Recadrage plus varié
    crop_factor = random.uniform(0.80, 0.98)  # Plus de variation dans le recadrage
    new_width = int(width * crop_factor)
    new_height = int(height * crop_factor)
    
    left = random.randint(0, width - new_width)
    top = random.randint(0, height - new_height)
    
    img = img.crop((left, top, left + new_width, top + new_height))
    
    # Ajouter un padding aléatoire plus varié
    if random.random() > 0.3:  # Plus fréquent
        pad_size = random.randint(5, 25)  # Plus de variation
        # Couleur de padding plus variée
        pad_color = tuple(random.randint(0, 50) for _ in range(3))
        img = ImageOps.expand(img, border=pad_size, fill=pad_color)
    
    return img

def resolve_output_format():
    """Determine if HEIC is supported; fallback to JPEG otherwise."""
    global OUTPUT_FORMAT, OUTPUT_EXTENSION, HEIC_SUPPORTED
    # Avoid probing by writing a HEIF test image, which can crash in some
    # environments. Trust pillow_heif registration and always target HEIC.
    OUTPUT_FORMAT = DESIRED_OUTPUT_FORMAT
    OUTPUT_EXTENSION = ".HEIC"
    HEIC_SUPPORTED = True
    print("ℹ️ HEIC output assumed supported (skipping save probe).")

def save_high_quality(img, exif_bytes=None):
    """Save image at high quality (95) with EXIF metadata - NO aggressive compression"""
    global OUTPUT_FORMAT, OUTPUT_EXTENSION
    quality = 95

    buffer = BytesIO()
    try:
        if exif_bytes:
            img.save(buffer, format=OUTPUT_FORMAT, quality=quality, optimize=False, exif=exif_bytes)
        else:
            img.save(buffer, format=OUTPUT_FORMAT, quality=quality, optimize=False)
    except Exception as e:
        # Fallback to JPEG if HEIC save failed
        print(f"⚠️ Saving as {OUTPUT_FORMAT} failed ({e}), falling back to JPEG.")
        OUTPUT_FORMAT = DEFAULT_FALLBACK_FORMAT
        OUTPUT_EXTENSION = ".jpg"
        buffer = BytesIO()
        if exif_bytes:
            img.save(buffer, format=OUTPUT_FORMAT, quality=quality, optimize=False, exif=exif_bytes)
        else:
            img.save(buffer, format=OUTPUT_FORMAT, quality=quality, optimize=False)

    size = buffer.tell()
    size_mb = size / 1024 / 1024
    print(f"  Image sauvegardée: {size_mb:.2f}MB avec qualité {quality} (format {OUTPUT_FORMAT})")

    return buffer.getvalue(), quality

def calculate_phash(image):
    """Calcule le perceptual hash (hex et binaire) pour une image PIL."""
    if not isinstance(image, Image.Image):
        raise TypeError("calculate_phash attend une instance PIL.Image")
    
    gray = image.convert('L')
    resized = gray.resize((8, 8), Image.BICUBIC)
    pixels = np.array(resized, dtype=np.float32)
    diff = pixels[:, 1:] > pixels[:, :-1]
    phash_bits = ''.join('1' if v else '0' for v in diff.flatten())
    phash_hex = format(int(phash_bits, 2), '016x')
    return phash_hex, phash_bits

def compute_hamming_distance(hash1_hex, hash2_hex):
    """Calcule la distance de Hamming entre deux hash hexadécimaux."""
    bin1 = bin(int(hash1_hex, 16))[2:].zfill(64)
    bin2 = bin(int(hash2_hex, 16))[2:].zfill(64)
    return sum(c1 != c2 for c1, c2 in zip(bin1, bin2))

def apply_phash_tweak(base_image, width, height, seed_value, intensity):
    """Applique des modifications localisées pour forcer un changement de pHash."""
    rng = np.random.default_rng(seed_value)
    arr = np.array(base_image, dtype=np.float32)
    
    # Bruit global léger
    sigma = 2.6 * intensity
    arr += rng.normal(0, sigma, arr.shape)
    
    # Ondes sinusoïdales horizontales et verticales
    freq = rng.uniform(0.8, 1.6)
    x = np.linspace(0, 2 * np.pi * freq, width, dtype=np.float32)
    y = np.linspace(0, 2 * np.pi * freq, height, dtype=np.float32)
    phase_x = rng.uniform(0, 2 * np.pi)
    phase_y = rng.uniform(0, 2 * np.pi)
    arr += np.sin(x + phase_x)[None, :, None] * (2.4 * intensity)
    arr += np.cos(y + phase_y)[:, None, None] * (2.4 * intensity)
    
    # Petites zones locales perturbées
    patch_count = max(4, int(6 * intensity))
    for _ in range(patch_count):
        patch_w = int(rng.integers(max(8, width // 40), max(16, width // 15)))
        patch_h = int(rng.integers(max(8, height // 40), max(16, height // 15)))
        x0 = int(rng.integers(0, max(1, width - patch_w)))
        y0 = int(rng.integers(0, max(1, height - patch_h)))
        delta = rng.normal(0, 5.5 * intensity, (patch_h, patch_w, 3))
        arr[y0:y0+patch_h, x0:x0+patch_w] += delta
    
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    tweaked = Image.fromarray(arr, 'RGB')
    blur_radius = 0.35 * intensity
    if blur_radius > 0:
        tweaked = tweaked.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    
    # Légers ajustements globaux pour finaliser
    brightness_shift = 1.0 + rng.uniform(-0.015, 0.015) * intensity
    contrast_shift = 1.0 + rng.uniform(-0.02, 0.02) * intensity
    tweaked = ImageEnhance.Brightness(tweaked).enhance(brightness_shift)
    tweaked = ImageEnhance.Contrast(tweaked).enhance(contrast_shift)
    return tweaked

def ensure_phash_difference(original_img, candidate_img, min_distance=10, max_attempts=25, verbose=False):
    """Assure une différence minimale de pHash entre l'original et l'image modifiée."""
    def vlog(message):
        if verbose:
            print(message)
            sys.stdout.flush()
    
    original_hex, original_bits = calculate_phash(original_img)
    best_image = candidate_img.copy()
    best_hex, best_bits = calculate_phash(best_image)
    best_distance = compute_hamming_distance(original_hex, best_hex)
    vlog(f"    [pHash] Distance initiale: {best_distance} bits")
    
    if best_distance >= min_distance:
        vlog("    [pHash] Cible déjà atteinte après randomisation principale.")
        return best_image, original_hex, original_bits, best_hex, best_bits, best_distance, 0, True
    
    width, height = best_image.size
    base_seed = int(time.time() * 1000000)
    best_reached = False
    attempts_used = 0
    
    for attempt in range(1, max_attempts + 1):
        attempts_used = attempt
        intensity = 0.45 + (attempt / max_attempts)
        seed_value = base_seed + attempt * 7919
        candidate = apply_phash_tweak(best_image, width, height, seed_value, intensity)
        candidate_hex, candidate_bits = calculate_phash(candidate)
        candidate_distance = compute_hamming_distance(original_hex, candidate_hex)
        
        if candidate_distance > best_distance:
            best_image = candidate
            best_hex = candidate_hex
            best_bits = candidate_bits
            best_distance = candidate_distance
            vlog(f"    [pHash] Amélioration (tentative {attempt}/{max_attempts}): {best_distance} bits")
            if best_distance >= min_distance:
                best_reached = True
                break
        elif verbose and attempt % 5 == 0:
            vlog(f"    [pHash] Tentative {attempt}/{max_attempts}: aucune amélioration (reste {best_distance} bits)")
    
    vlog(f"    [pHash] Distance finale obtenue: {best_distance} bits (cible {min_distance})")
    if verbose and not best_reached:
        vlog("    [pHash] Cible non atteinte malgré les tentatives maximales.")
    return best_image, original_hex, original_bits, best_hex, best_bits, best_distance, attempts_used, best_reached

def process_single_image_ultra_anti_detection(source_img, output_folder):
    """Traitement ultra-agressif anti-détection"""
    # Use module-level output settings; otherwise assignments below shadow locals
    global OUTPUT_FORMAT, OUTPUT_EXTENSION
    try:
        # Copie de travail
        img = source_img.copy()
        width, height = img.size
        min_phash_distance = 10
        
        def log_step(label):
            print(label)
            sys.stdout.flush()
        
        # 1. Redimensionnement plus variable
        log_step("  Étape 1/19: redimensionnement initial...")
        scale_factor = random.uniform(0.85, 1.15)  # Plus de variation
        new_size = (int(width * scale_factor), int(height * scale_factor))
        img = img.resize(new_size, random.choice([Image.LANCZOS, Image.BICUBIC, Image.BILINEAR]))

        # 2. Rotation avec angle plus variable
        log_step("  Étape 2/19: rotation subtile...")
        rotation_angle = random.uniform(-5, 5)  # Reduced rotation range
        img = img.rotate(rotation_angle, expand=True, fillcolor=(random.randint(0, 30), random.randint(0, 30), random.randint(0, 30)))

        # 3. Recadrage intelligent
        log_step("  Étape 3/19: recadrage & padding aléatoires...")
        img = smart_crop_and_pad(img)

        # 4. Miroir horizontal seulement
        if random.random() > 0.5:
            log_step("  Étape 4/19: miroir horizontal appliqué.")
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        else:
            log_step("  Étape 4/19: miroir horizontal ignoré.")

        # 5. Modifications de couleur agressives
        log_step("  Étape 5/19: ajustements couleur/luminosité...")
        img = random_color_aggressive(img)
        img = random_gamma_correction(img)

        # 6. Ajout de bruit plus varié mais sans changer les couleurs
        log_step("  Étape 6/19: ajout de bruit contrôlé...")
        noise_intensity = random.randint(1, 2)  # Very subtle noise intensity
        img = add_advanced_noise(img, noise_intensity)

        # 7. Distorsion locale plus variable
        log_step("  Étape 7/19: distorsion locale...")
        img = advanced_local_distortion(img, amplitude=random.randint(2, 6))  # Plus de variation

        # 8. Filtres aléatoires
        log_step("  Étape 8/19: application de filtres multiples...")
        img = apply_random_filter(img)

        # 9. Modifications invisibles
        log_step("  Étape 9/19: watermark/bruit haute fréquence...")
        img = add_invisible_watermark(img)

        # 10. Simulation d'artéfacts JPEG (100% pour maximum d'obfuscation)
        log_step("  Étape 10/19: simulation d'artéfacts JPEG...")
        img = random_jpeg_artifacts(img)  # Toujours appliqué

        # 11. Redimensionnement final avec taille plus variable
        log_step("  Étape 11/19: redimensionnement final variable...")
        final_width = random.randint(2000, 4000)  # Plus de variation dans la taille finale
        final_height = int(img.size[1] * (final_width / img.size[0]))
        img = img.resize((final_width, final_height), random.choice([Image.LANCZOS, Image.BICUBIC, Image.BILINEAR]))

        # 13. Falloff optique de netteté pour simuler la lentille
        log_step("  Étape 13/19: falloff de netteté optique...")
        falloff_strength = random.uniform(0.22, 0.42)
        img = apply_radial_sharpness_falloff(img, falloff_strength)

        # 14. Injection PRNU style iPhone (per-image)
        log_step("  Étape 14/19: injection PRNU façon capteur iPhone...")
        prnu_strength = random.uniform(0.0015, 0.0035)
        img = apply_prnu_spoofing(img, prnu_strength)

        # 15. Modification contrôlée des coefficients DCT
        log_step("  Étape 15/19: modification contrôlée des DCT...")
        dct_jitter = random.uniform(0.02, 0.05)
        img = modify_dct_coefficients(img, jitter_strength=dct_jitter)

        # 16. Randomisation LSB + micro-shift
        log_step("  Étape 16/19: randomisation LSB et micro-shift de pixels...")
        img = apply_lsb_randomization_and_microshift(img, lsb_ratio=0.35, shift_ratio=0.15)

        # 17. Ajustements ciblés sur le pHash
        log_step("  Étape 17/19: ajustement ciblé du pHash...")
        img, orig_hex, orig_bits, new_hex, new_bits, hamming_bits, attempts_used, reached_target = ensure_phash_difference(
            source_img, img, min_distance=min_phash_distance, verbose=True
        )
        diff_percent = (hamming_bits / 64) * 100
        similarity_percent = 100 - diff_percent
        print("  Vérification pHash:")
        print(f"    Original : {orig_hex}")
        print(f"    Modifié  : {new_hex}")
        print(f"    Binaire  : {orig_bits}")
        print(f"             : {new_bits}")
        print(f"    Hamming  : {hamming_bits} bits ({diff_percent:.2f}% différence, {similarity_percent:.2f}% similarité)")
        if attempts_used:
            print(f"    Tentatives pour atteindre la cible: {attempts_used}")
        if not reached_target:
            print(f"    [!] Distance cible {min_phash_distance} bits non atteinte (meilleur: {hamming_bits})")
        else:
            print(f"    ✓ Distance cible {min_phash_distance} bits atteinte")
        
        # Générer un nom réaliste de style iPhone (IMG_1234.jpg) tout en garantissant l'unicité
        base_filename = generate_random_filename()
        candidate_name = f"{base_filename}{OUTPUT_EXTENSION}"
        save_path = os.path.join(output_folder, candidate_name)
        attempt_index = 1
        while os.path.exists(save_path):
            attempt_index += 1
            candidate_name = f"{base_filename}_{attempt_index}{OUTPUT_EXTENSION}"
            save_path = os.path.join(output_folder, candidate_name)

        # 18. Génération des métadonnées EXIF iPhone
        log_step("  Étape 18/19: génération métadonnées iPhone...")
        final_width, final_height = img.size
        exif_bytes = create_iphone_exif(final_width, final_height)

        # 19. Sauvegarde haute qualité sans compression aggressive
        log_step("  Étape 19/19: sauvegarde haute qualité...")

        def helper_save_heif_via_subprocess(image_obj, dest_path, exif_blob):
            """Attempt HEIF save in a child process to avoid crashing the main worker."""
            py_exe = sys.executable or "python3"

            tmp_image = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp_exif = tempfile.NamedTemporaryFile(delete=False, suffix=".exif")
            tmp_image_path = tmp_image.name
            tmp_exif_path = tmp_exif.name
            tmp_image.close()
            tmp_exif.close()
            try:
                # Save as PNG to feed the child process
                image_obj.save(tmp_image_path, format="PNG")
                if exif_blob:
                    with open(tmp_exif_path, "wb") as f:
                        f.write(exif_blob)
                child_code = r"""
import sys
from pillow_heif import register_heif_opener
from PIL import Image

png_path, dest_path, exif_path = sys.argv[1:4]
register_heif_opener()
img = Image.open(png_path).convert("RGB")
exif_bytes = None
if exif_path:
    with open(exif_path, "rb") as f:
        exif_bytes = f.read()
img.save(dest_path, format="HEIF", quality=95, exif=exif_bytes, optimize=False)
"""
                result = subprocess.run(
                    [py_exe, "-c", child_code, tmp_image_path, dest_path, tmp_exif_path if exif_blob else ""],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=120,
                )
                if result.returncode != 0:
                    print(f"⚠️ Sous-processus HEIF échec (code {result.returncode}): {result.stderr.decode(errors='ignore')}")
                    return False
                return True
            except Exception as child_error:
                print(f"⚠️ Sous-processus HEIF exception: {child_error}")
                return False
            finally:
                for tmp_path in (tmp_image_path, tmp_exif_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

        # Save with high quality (95) to preserve photo quality and fallback to JPEG if needed
        saved_as_heif = False
        if OUTPUT_FORMAT.upper() == "HEIF":
            # Try HEIF in a child process to protect against crashes
            saved_as_heif = helper_save_heif_via_subprocess(img, save_path, exif_bytes)
            if not saved_as_heif:
                raise RuntimeError("Échec de l'enregistrement HEIF dans le sous-processus")

        if not saved_as_heif:
            if OUTPUT_FORMAT.upper() == "HEIF":
                # If HEIF was requested but helper failed, abort to avoid corrupt state.
                raise RuntimeError("Impossible de sauvegarder en HEIF (échec du sous-processus).")
            else:
                img.save(save_path, format=OUTPUT_FORMAT, quality=95, exif=exif_bytes, optimize=False)

        generated_filename = os.path.basename(save_path)
        print(f"  Fichier de sortie: {generated_filename}")
        sys.stdout.flush()

        # Vérifier la taille finale
        file_size = os.path.getsize(save_path)
        final_size_mb = file_size / 1024 / 1024
        print(f"  Image sauvée: {final_size_mb:.2f}MB avec qualité 95 (pas de compression)")
        
        # Vérifier le pHash après sauvegarde
        with Image.open(save_path) as saved_img:
            saved_img = saved_img.convert('RGB')
            saved_hex, saved_bits = calculate_phash(saved_img)
        saved_distance = compute_hamming_distance(orig_hex, saved_hex)
        if saved_distance != hamming_bits:
            print("  Post-sauvegarde pHash:")
            print(f"    Hash     : {saved_hex}")
            print(f"    Hamming  : {saved_distance} bits ({(64 - saved_distance) / 64 * 100:.2f}% similarité)")
        else:
            print("  Post-sauvegarde pHash identique au résultat précédent.")
        if saved_distance < min_phash_distance:
            print(f"  [!] Avertissement: distance post-sauvegarde {saved_distance} bits < cible {min_phash_distance}.")
        else:
            print(f"  ✓ Distance post-sauvegarde confirmée: {saved_distance} bits (>= {min_phash_distance}).")
        
        return True, generated_filename
        
    except Exception as e:
        print(f"Erreur lors du traitement: {e}")
        return False, None

def select_random_photos(source_folder, count=3):
    """Sélectionne aléatoirement 'count' photos du dossier source"""
    try:
        register_heif_opener()
    except Exception as e:
        print(f"⚠️ register_heif_opener a échoué: {e}. Lecture HEIC désactivée.")

    # Vérifier que le dossier source existe
    if not os.path.exists(source_folder):
        print(f"Erreur: Le dossier '{source_folder}' n'existe pas!")
        return []
    
    # Récupérer tous les fichiers d'images
    image_extensions = ('.heic', '.png', '.jpeg', '.jpg', '.webp', '.bmp')
    all_files = [f for f in os.listdir(source_folder) 
                 if f.lower().endswith(image_extensions)]
    
    if len(all_files) < count:
        print(f"Erreur: Le dossier ne contient que {len(all_files)} images, mais {count} sont demandées.")
        return []
    
    # Sélectionner aléatoirement 'count' photos
    selected_files = random.sample(all_files, count)
    print(f"Photos sélectionnées: {selected_files}")
    
    # Charger les images en mémoire
    loaded_images = []
    for filename in selected_files:
        filepath = os.path.join(source_folder, filename)
        try:
            with Image.open(filepath) as img:
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                # Stocker une copie en mémoire avec le nom du fichier original
                loaded_images.append({
                    'image': img.copy(),
                    'original_name': filename
                })
        except Exception as e:
            print(f"Erreur lors du chargement de {filename}: {e}")
    
    return loaded_images

def randomize_photos(photo_count=3, output_folder=None, input_dir=None):
    """Fonction principale pour randomiser un nombre spécifique de photos aléatoires"""
    print("=" * 60)
    print(f"RANDOMISATION DE {photo_count} PHOTOS ALÉATOIRES")
    print("=" * 60)
    
    # Dossier source des photos (allpictures par défaut)
    source_folder = os.path.abspath(input_dir) if input_dir else os.path.abspath("allpictures")
    
    # Créer le dossier de sortie
    done_folder = ensure_done_directory(output_folder)
    
    # Keep track of generated <-> original photo name mapping
    photo_mappings = []
    original_names = []
    
    # Sélectionner le nombre de photos spécifié
    selected_images = select_random_photos(source_folder, photo_count)
    
    if not selected_images:
        print(f"Impossible de charger les photos. Vérifiez le dossier {source_folder}.")
        return
    
    print(f"\nDébut de la randomisation de {len(selected_images)} photos...")
    start_time = time.time()
    
    success_count = 0
    for i, image_data in enumerate(selected_images):
        original_name = image_data['original_name']
        print(f"Traitement de l'image {i+1}/{photo_count}: {original_name}")
        sys.stdout.flush()
        
        success, generated_filename = process_single_image_ultra_anti_detection(
            image_data['image'], done_folder
        )
        if success and generated_filename:
            success_count += 1
            original_names.append(original_name)
            photo_mappings.append({
                'generated': generated_filename,
                'original': original_name,
            })
            print(f"  [OK] Image {i+1} traitée avec succès")
        else:
            print(f"  [ERROR] Erreur lors du traitement de l'image {i+1}")
        sys.stdout.flush()
    
    end_time = time.time()
    processing_time = end_time - start_time
    
    print(f"\n{'='*60}")
    print(f"TRAITEMENT TERMINÉ")
    print(f"{'='*60}")
    print(f"Photos traitées avec succès: {success_count}/{photo_count}")
    print(f"Temps de traitement: {processing_time:.2f} secondes")
    print(f"Photos sauvegardées dans: {done_folder}/")
    print(f"Photos originales conservées dans: {source_folder}/")
    
    # Output original photo names for Node.js workers to parse
    if original_names:
        print(f"ORIGINAL_NAMES_START")
        for original_name in original_names:
            print(f"ORIGINAL: {original_name}")
        print(f"ORIGINAL_NAMES_END")

    # Persist mapping files for downstream services
    if photo_mappings:
        mapping_json_path = os.path.join(done_folder, ".original-names.json")
        mapping_txt_path = os.path.join(done_folder, ".original_names")

        # Load existing mapping if available
        existing_mapping = {}
        if os.path.exists(mapping_json_path):
            try:
                with open(mapping_json_path, 'r', encoding='utf-8') as mapping_file:
                    existing_mapping = json.load(mapping_file)
            except (json.JSONDecodeError, OSError) as e:
                print(f"⚠️  Impossible de lire {mapping_json_path}: {e}. Le fichier sera recréé.")

        # Update with the latest batch
        for mapping in photo_mappings:
            existing_mapping[mapping['generated']] = mapping['original']

        try:
            with open(mapping_json_path, 'w', encoding='utf-8') as mapping_file:
                json.dump(existing_mapping, mapping_file, ensure_ascii=False, indent=2)
            print(f"📝 Mapping JSON mis à jour: {mapping_json_path}")
        except OSError as e:
            print(f"❌ Erreur lors de l'écriture de {mapping_json_path}: {e}")

        # Also write a legacy-friendly text file with tab-separated values
        try:
            with open(mapping_txt_path, 'w', encoding='utf-8') as legacy_file:
                for generated_name, original_name in existing_mapping.items():
                    legacy_file.write(f"{generated_name}\t{original_name}\n")
            print(f"📝 Mapping texte mis à jour: {mapping_txt_path}")
        except OSError as e:
            print(f"❌ Erreur lors de l'écriture de {mapping_txt_path}: {e}")
    
    print(f"{'='*60}")

def parse_cli_arguments(args):
    """Parse CLI arguments while keeping backward compatibility."""
    input_dir = None
    positional_args = []

    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("--input", "-i") and i + 1 < len(args):
            input_dir = args[i + 1]
            i += 2
            continue
        positional_args.append(arg)
        i += 1

    photo_count = 3  # Default value
    output_folder = None  # Default to DONE folder

    if len(positional_args) > 0:
        try:
            photo_count = int(positional_args[0])
        except ValueError:
            print(f"Erreur: Nombre de photos invalide '{positional_args[0]}'. Utilisation de la valeur par défaut: 3")
            photo_count = 3

    if len(positional_args) > 1:
        output_folder = positional_args[1]
        print(f"Dossier de sortie personnalisé: {output_folder}")

    return photo_count, output_folder, input_dir

def cli_main(argv=None):
    """Entry point when run as a script."""
    global HEIC_SUPPORTED
    args = argv if argv is not None else sys.argv[1:]

    HEIC_SUPPORTED = True

    # Définir le seed aléatoire pour plus de variations
    seed_value = int(time.time() * 1000000) % 2**32
    random.seed(seed_value)
    np.random.seed(seed_value)

    # Register HEIC support and detect output format
    if HEIC_SUPPORTED:
        try:
            register_heif_opener()
        except Exception as e:
            print(f"⚠️ Impossible d'activer HEIF: {e}")
            HEIC_SUPPORTED = False

    resolve_output_format()
    photo_count, output_folder, input_dir = parse_cli_arguments(args)
    
    randomize_photos(photo_count, output_folder, input_dir)


if __name__ == "__main__":
    # Ensure local imports (metadata_spoofer, etc.) resolve even when invoked
    # from nested working directories.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    cli_main()

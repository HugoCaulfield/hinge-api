import math
import random
from datetime import datetime, timedelta


def generate_random_filename():
  """Return a pseudo iOS filename (IMG_XXXX)."""
  random_digits = "".join(str(random.randint(0, 9)) for _ in range(4))
  return f"IMG_{random_digits}"


def generate_random_location():
  """Generate realistic GPS metadata focused on continental US coordinates."""
  lat = random.uniform(25.0, 49.0)
  lon = random.uniform(-125.0, -66.0)
  altitude = random.uniform(0, 500)

  lat_ref = "N"
  lon_ref = "W"

  lat_deg = int(lat)
  lat_min = int((lat - lat_deg) * 60)
  lat_sec = ((lat - lat_deg) * 60 - lat_min) * 60

  lon_deg = int(abs(lon))
  lon_min = int((abs(lon) - lon_deg) * 60)
  lon_sec = ((abs(lon) - lon_deg) * 60 - lon_min) * 60

  lat_str = f"{lat_deg} deg {lat_min}' {lat_sec:.1f}\""
  lon_str = f"{lon_deg} deg {lon_min}' {lon_sec:.1f}\""

  gps_timestamp = datetime.utcnow() - timedelta(days=random.randint(0, 365))
  gps_datestamp = gps_timestamp.strftime("%Y:%m:%d")
  gps_timestamp_str = gps_timestamp.strftime("%H:%M:%S.%f")[:-3]

  satellites = str(random.randint(4, 12))
  measurement_status = "A"
  measure_mode = "3"

  return {
    "GPSLatitudeRef": lat_ref,
    "GPSLatitude": lat_str,
    "GPSLongitudeRef": lon_ref,
    "GPSLongitude": lon_str,
    "GPSPosition": f"{lat:.6f}, {lon:.6f}",
    "GPSAltitudeRef": "0",
    "GPSAltitude": f"{altitude:.1f}",
    "GPSDateStamp": gps_datestamp,
    "GPSTimeStamp": gps_timestamp_str,
    "GPSSatellites": satellites,
    "GPSStatus": measurement_status,
    "GPSMeasureMode": measure_mode,
    "GPSDOP": f"{random.uniform(1.0, 3.0):.2f}",
    "GPSMapDatum": "WGS-84",
    "GPSVersionID": "2.3.0.0",
    "LatitudeDecimal": lat,
    "LongitudeDecimal": lon,
    "AltitudeMeters": altitude,
  }


def generate_random_dates():
  """Generate realistic creation/modify timestamps within the last year."""
  days_back = random.randint(1, 365)
  base_date = datetime.utcnow() - timedelta(days=days_back)

  mod_date = base_date + timedelta(minutes=random.randint(1, 60))
  create_date = base_date.strftime("%Y:%m:%d %H:%M:%S")
  digitized_date = create_date
  modify_date = mod_date.strftime("%Y:%m:%d %H:%M:%S")

  file_date = base_date.strftime("%Y%m%d_%H%M%S")
  subsecs = str(random.randint(0, 999)).zfill(3)

  return {
    "CreateDate": create_date,
    "DateTimeOriginal": create_date,
    "DateTimeDigitized": digitized_date,
    "ModifyDate": modify_date,
    "SubSecTime": subsecs,
    "SubSecTimeOriginal": subsecs,
    "SubSecTimeDigitized": subsecs,
    "FileCreateDate": create_date,
    "FileModifyDate": modify_date,
    "FileAccessDate": modify_date,
    "FileInodeChangeDate": modify_date,
    "FileNameCreateDate": file_date,
  }


def generate_iphone_model():
  """Pick an iPhone 12-16 variant to mimic Apple hardware diversity."""
  variants = [" Pro", " Pro Max", " Plus", " Mini", ""]
  variant_weights = [0.3, 0.3, 0.2, 0.1, 0.1]
  iphone_bases = ["iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15", "iPhone 16"]
  base_weights = [0.1, 0.15, 0.25, 0.3, 0.2]

  iphone_model = random.choices(iphone_bases, weights=base_weights)[0]
  variant = random.choices(range(len(variants)), weights=variant_weights)[0]
  return f"{iphone_model}{variants[variant]}"


def generate_camera_exif(iphone_model):
  """Build EXIF-like camera descriptors for the requested iPhone."""
  camera_specs = {
    "iPhone 12": {
      "iso_range": (20, 3200),
      "aperture_values": [1.6, 2.0, 2.4],
      "focal_lengths": [4.2, 6.0],
      "focal_35mm": [26, 52],
    },
    "iPhone 12 Pro": {
      "iso_range": (20, 3200),
      "aperture_values": [1.6, 2.0, 2.4],
      "focal_lengths": [4.2, 6.0, 7.5],
      "focal_35mm": [26, 52, 65],
    },
    "iPhone 12 Pro Max": {
      "iso_range": (20, 3200),
      "aperture_values": [1.6, 2.2, 2.4],
      "focal_lengths": [5.1, 6.0, 7.5],
      "focal_35mm": [26, 52, 65],
    },
    "iPhone 13": {
      "iso_range": (20, 4000),
      "aperture_values": [1.6, 2.4],
      "focal_lengths": [5.7, 4.2],
      "focal_35mm": [26, 52],
    },
    "iPhone 13 Pro": {
      "iso_range": (20, 6400),
      "aperture_values": [1.5, 1.8, 2.8],
      "focal_lengths": [5.7, 2.71, 9.0],
      "focal_35mm": [13, 26, 77],
    },
    "iPhone 14": {
      "iso_range": (20, 5000),
      "aperture_values": [1.5, 2.4],
      "focal_lengths": [5.7, 4.2],
      "focal_35mm": [26, 52],
    },
    "iPhone 14 Pro": {
      "iso_range": (20, 12800),
      "aperture_values": [1.78, 2.2, 2.8],
      "focal_lengths": [5.7, 6.86, 9.0],
      "focal_35mm": [13, 24, 77],
    },
    "iPhone 15": {
      "iso_range": (25, 6400),
      "aperture_values": [1.6, 2.4],
      "focal_lengths": [5.7, 4.2],
      "focal_35mm": [26, 52],
    },
    "iPhone 15 Pro": {
      "iso_range": (25, 12800),
      "aperture_values": [1.78, 2.2, 2.8],
      "focal_lengths": [5.7, 6.86, 9.0],
      "focal_35mm": [13, 24, 77],
    },
    "iPhone 16": {
      "iso_range": (25, 8000),
      "aperture_values": [1.6, 2.4],
      "focal_lengths": [5.7, 4.2],
      "focal_35mm": [26, 52],
    },
    "iPhone 16 Pro": {
      "iso_range": (25, 12800),
      "aperture_values": [1.78, 2.2, 2.8],
      "focal_lengths": [5.7, 6.86, 9.0],
      "focal_35mm": [13, 24, 120],
    },
  }

  base_model = next((model for model in camera_specs if model in iphone_model), "iPhone 14")
  specs = camera_specs[base_model]
  lens_options = min(len(specs["aperture_values"]), len(specs["focal_lengths"]), len(specs["focal_35mm"]))
  lens_index = random.randint(0, max(0, lens_options - 1))

  aperture = specs["aperture_values"][lens_index]
  focal_length = specs["focal_lengths"][lens_index]
  focal_35mm = specs["focal_35mm"][lens_index]

  shutter_speeds = [
    "1/1000",
    "1/800",
    "1/640",
    "1/500",
    "1/400",
    "1/320",
    "1/250",
    "1/200",
    "1/160",
    "1/125",
    "1/100",
    "1/80",
    "1/60",
    "1/50",
    "1/40",
    "1/30",
    "1/25",
    "1/20",
    "1/15",
    "1/10",
  ]
  shutter_speed = random.choice(shutter_speeds)
  numerator, denominator = shutter_speed.split("/")
  exposure_tuple = (int(numerator), int(denominator))
  exposure_time_value = float(denominator)
  shutter_speed_value = math.log(exposure_time_value, 2)
  aperture_value = 2 * math.log(aperture, 2)

  lens_serial = "".join(random.choices("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=12))
  brightness_value = random.uniform(-2, 8)
  exposure_compensation = random.choice(["-2/3", "-1/3", "0", "+1/3", "+2/3"])
  timezone_offset = random.choice(
    [
      "-12:00",
      "-11:00",
      "-10:00",
      "-09:00",
      "-08:00",
      "-07:00",
      "-06:00",
      "-05:00",
      "-04:00",
      "-03:00",
      "-02:00",
      "-01:00",
      "+00:00",
      "+01:00",
      "+02:00",
      "+03:00",
      "+04:00",
      "+05:00",
      "+06:00",
      "+07:00",
      "+08:00",
      "+09:00",
      "+10:00",
      "+11:00",
      "+12:00",
      "+13:00",
      "+14:00",
    ]
  )

  major = random.choice([15, 16, 17, 18])
  minor = random.randint(0, 7)
  patch = random.randint(0, 5)
  ios_version = f"{major}.{minor}.{patch}"

  return {
    "Make": "Apple",
    "Model": iphone_model,
    "Software": f"iOS {ios_version}",
    "LensMake": "Apple",
    "LensModel": f"{iphone_model} back camera {focal_length}mm f/{aperture}",
    "LensSerialNumber": lens_serial,
    "SerialNumber": "".join(random.choices("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=12)),
    "Aperture": str(aperture),
    "ApertureValue": str(aperture_value),
    "MaxApertureValue": str(aperture_value),
    "ShutterSpeed": shutter_speed,
    "ShutterSpeedValue": str(shutter_speed_value),
    "FocalLength": f"{focal_length} mm",
    "FocalLengthValue": focal_length,
    "FocalLengthIn35mmFormat": focal_35mm,
    "FNumber": aperture,
    "ExposureTime": shutter_speed,
    "ExposureTimeTuple": exposure_tuple,
    "ExposureProgram": "2",
    "ExposureMode": "0",
    "ExposureCompensation": exposure_compensation,
    "BrightnessValue": str(brightness_value),
    "MeteringMode": "5",
    "Flash": "16",
    "WhiteBalance": "0",
    "ColorSpace": "1",
    "SceneCaptureType": "0",
    "Contrast": "0",
    "Saturation": "0",
    "Sharpness": "0",
    "DigitalZoomRatio": "1",
    "OffsetTime": timezone_offset,
    "OffsetTimeOriginal": timezone_offset,
    "OffsetTimeDigitized": timezone_offset,
    "ExifVersion": "0232",
    "FlashpixVersion": "0100",
    "ComponentsConfiguration": "1 2 3 0",
    "YCbCrPositioning": "1",
    "ISORange": specs["iso_range"],
  }


def convert_decimal_to_dms(value):
  """Convert decimal degrees to EXIF-ready rational tuples."""
  abs_value = abs(value)
  degrees = int(abs_value)
  minutes = int((abs_value - degrees) * 60)
  seconds = (abs_value - degrees - minutes / 60) * 3600
  return ((degrees, 1), (minutes, 1), (int(seconds * 1000), 1000))


def parse_fraction_to_tuple(value):
  """Convert a string like '+1/3' to a rational tuple."""
  if isinstance(value, (int, float)):
    return (int(value * 1000), 1000)

  if not isinstance(value, str):
    return (0, 1)

  val = value.strip()
  if not val:
    return (0, 1)

  sign = 1
  if val[0] == "+":
    val = val[1:]
  elif val[0] == "-":
    sign = -1
    val = val[1:]

  if "/" in val:
    num, den = val.split("/", 1)
    try:
      numerator = int(num) * sign
      denominator = int(den)
      if denominator == 0:
        return (0, 1)
      return (numerator, denominator)
    except ValueError:
      return (0, 1)

  try:
    fractional = float(val) * sign
    return (int(fractional * 1000), 1000)
  except ValueError:
    return (0, 1)


def generate_spoofed_metadata():
  """Bundle camera, GPS, and timestamp metadata for consumers."""
  iphone_model = generate_iphone_model()
  camera_data = generate_camera_exif(iphone_model)
  location_data = generate_random_location()
  date_data = generate_random_dates()
  iso_min, iso_max = camera_data.get("ISORange", (25, 3200))
  iso_value = random.randint(int(iso_min), int(iso_max))

  return {
    "iphone_model": iphone_model,
    "camera": camera_data,
    "location": location_data,
    "dates": date_data,
    "iso": iso_value,
  }


__all__ = [
  "generate_random_filename",
  "generate_random_location",
  "generate_random_dates",
  "generate_iphone_model",
  "generate_camera_exif",
  "convert_decimal_to_dms",
  "parse_fraction_to_tuple",
  "generate_spoofed_metadata",
]

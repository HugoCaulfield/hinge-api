# Hinge API - Run Guide

This project contains:
- A local API server (the "web app") in `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api`
- A background photo pre-generation worker directly in `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api`

## Prerequisites

- Node.js `>= 20`
- npm
- Python 3 (for photo worker spoofers)
- Optional but recommended when using `iphone_exif_gui_reconstructed`: `exiftool`

## 1) Launch the API (web app)

Run from:
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api`

Install dependencies:

```bash
npm install
```

Create env file:

```bash
cp .env.example .env
```

Set your credentials in either:
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/.env`
- or `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/config/local-config.json`

Main variables:
- `API_KEY` (client auth key for `/v1/*`)
- `DAISYSMS_API_KEY`
- `ANYMESSAGE_TOKEN`

Start API:

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Auth check example:

```bash
curl -H "x-api-key: change-me" http://127.0.0.1:3000/v1/jobs/test
```

## 2) Launch the photo worker

Run from:
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api`

Install Python dependencies:

```bash
python3 -m pip install -r /Users/hugocaulfield/Docs/ofm_tinder/hinge-api/scripts/python/requirements.txt
```

If you use spoofer `iphone_exif_gui_reconstructed`, install exiftool:

```bash
brew install exiftool
```

Start worker:

```bash
npm run start:photo-worker
```

Equivalent direct command:

```bash
node /Users/hugocaulfield/Docs/ofm_tinder/hinge-api/start-photo-worker.js
```

## 3) Run API + worker together (recommended)

Use 2 terminals:

Terminal A:

```bash
cd /Users/hugocaulfield/Docs/ofm_tinder/hinge-api
npm start
```

Terminal B:

```bash
cd /Users/hugocaulfield/Docs/ofm_tinder/hinge-api
npm run start:photo-worker
```

## 4) Quick troubleshooting

- `401 Invalid API key`: send `x-api-key` header matching your configured `API_KEY`.
- `Daisy/AnyMessage missing key` warnings: set `DAISYSMS_API_KEY` and `ANYMESSAGE_TOKEN`.
- Worker cannot generate photos: verify model source photos exist in:
  - `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/scripts/python/<model>/`
- `exiftool not found`: install `exiftool` or switch spoofer to `random_three`.


## Photo spoofing behavior

- `photos.useSpoofing=true`: uses pool photos generated with full spoofing pipeline.
- `photos.useSpoofing=false`: still spoofs metadata (iPhone/GPS/date) with `iphone_exif_gui_reconstructed` at `modification-level=0`, so pixels are not intentionally altered.

# Telegram Bot Features Audit (for API migration)

## 1) Scope and objective

This document inventories the real behavior implemented in the current Telegram bot codebase, to migrate it to a JavaScript API with feature parity.

Codebase analyzed:
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/current_telegram_bot/src/**`
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/current_telegram_bot/config/**`
- `/Users/hugocaulfield/Docs/ofm_tinder/hinge-api/current_telegram_bot/scripts/python/**`
- runtime entrypoints and PM2 configs

This audit is based on code behavior (not only README).

## 2) Current architecture

Main runtime pieces:
- Bot launcher: `start.js` -> sets env from app config -> spawns `src/app.js`
- Bot runtime: `src/app.js` -> initializes Telegram bot + DaisySMS webhook HTTP server
- Telegram interface layer: `src/bot/index.js`
- Business handlers: `src/bot/handlers/main.js`, `src/bot/handlers/admin.js`
- Core services:
  - Proxy: `src/core/proxy/*`
  - SMS: `src/core/sms/*`
  - Email: `src/core/email/anymessage.js`
  - Photos: `src/core/photo/*`
  - Location lookup: `src/core/location/*`

Background worker:
- Photo stock pre-generation worker: `src/core/photo/background-photo-worker.js`
- Start wrapper: `start-photo-worker.js`

## 3) Multi-app configuration in production

App configs are hardcoded in `config/app-config.js`.

Configured app keys:
- `tinder-dev`
- `tinder-prod-1`
- `tinder-prod-2`
- `tinder-prod-3`
- `hinge-dev`
- `hinge-prod-1`
- `hinge-prod-2`
- `hinge-prod-3`
- `hinge-prod-4`
- `bumble-prod-1`
- `hinge-no-spoofing-1`
- `hinge-no-spoofing-2`
- `hinge-no-spoofing-3`

Per app, current code configures:
- Telegram token
- photo count (3 or 6)
- `allowRegenerate` (currently false everywhere)
- `useSpoofing` + selected spoofer (`random_three` or `iphone_exif_gui_reconstructed`)
- SMS provider list + service IDs/codes
- proxy provider order

Notable current behavior:
- Tinder apps: mostly `marsproxies` + DaisySMS `oi`/`926`
- Hinge prod apps: mostly `anyIp` + DaisySMS `vz`/`420`
- No-spoofing Hinge apps: `useSpoofing=false` (serve original photos)

## 4) User-facing Telegram features

### 4.1 Auth and access control

- Every incoming message is checked against `AUTHORIZED_USERS`.
- Unauthorized users get `You are not authorized to use this bot`.
- Admin commands are gated by `ADMIN_USERS`.

### 4.2 User commands and text inputs

- `/help`
  - shows usage and examples.

- `/generate_new_proxy State/Region, City`
  - proxy only flow (no SMS, no email).

- Plain text `State/Region, City`
  - full flow:
    - location validation
    - proxy generation + validation
    - phone number acquisition + code polling
    - optional email (Hinge family)
    - photos + proxy JSON file delivery
    - status buttons / Airtable links

### 4.3 Inline buttons

Buttons generated depending on app:
- `New Proxy`
- `New Phone`
- `New Email` (Hinge family only)
- `Regenerate Photos` (only if `allowRegenerate=true`; currently disabled in config)
- status buttons:
  - `Live`
  - `Facetec`
  - `Shadowban`
  - `Logged out`
  - `Phone Already Used`

Current status behavior:
- status click opens Airtable form directly from stored context (tokens no longer required).

### 4.4 Full package payload delivered to user

On successful full flow, bot returns:
- proxy credentials: `domain:port:username:password`
- proxy IP
- city/state + random coordinates
- model name (+ age when known)
- generated DOB + zodiac
- phone number
- email when available (Hinge path)
- command reminder to regenerate proxy
- proxy JSON config file attachment
- photo files as documents (media group if possible)

## 5) Location feature set

Source datasets:
- `data/locations_usa.csv`
- `data/locations_uk.csv`
- `data/locations_italy.csv`
- `data/locations_au.csv`
- `data/locations_ca.csv`

Behavior:
- Parses strict `State/Region, City` format.
- Exact case-insensitive city/state match in dataset.
- Country coverage from CSV files above.
- Returns area code string from CSV (US has populated area codes; other datasets mostly blank).
- Generates randomized coordinate inside radius around city center (implemented with turf circle/random point).

## 6) Proxy system feature set

### 6.1 Proxy generation and fallback

- Proxy provider order comes from app config (`appConfig.proxy.providers`).
- Fallback loop:
  - tries provider in order
  - up to `MAX_RETRIES` attempts/provider (`utils/constants.js`: 10)
  - 1s delay between attempts

Supported provider configs in code:
- `marsproxies`
- `proxyempire`
- `dataimpulse`
- `dataimpulse_mobile`
- `anyIp`

### 6.2 Quality validation before accepting proxy

For each candidate proxy:
- resolve external IP through proxy (`api.ipify.org`) using SOCKS agent
- reject if IP retrieval fails
- reject if IP retrieval takes > 5s
- run Scamalytics check:
  - first via HTML scraping (`https://scamalytics.com/ip/<ip>`)
  - if blocked/403, fallback to Python script `scripts/python/scamalytics_score.py`
- require low risk only
- require Scamalytics city/state to match requested location (normalized comparison)

### 6.3 Output fields and artifacts

Accepted proxy returns:
- domain/port/username/password
- public IP
- provider display + provider key
- Scamalytics score/risk fields
- plus placeholders for extra datasource fields (present in context payload)

Bot also generates and sends proxy JSON file (`file_manager.createProxyJSON`).

### 6.4 Active search protection

- In-memory map prevents overlapping proxy searches per chat.
- bot startup clears stale active proxy searches.

## 7) SMS system feature set

### 7.1 Provider fallback and area code logic

SMS providers are ordered per app (`appConfig.sms.providers`), defaults to DaisySMS then SMSPool.

DaisySMS path:
- API call with service code (`SMS_SERVICE_CODE`)
- supports multi-area code string in one request.

SMSPool path:
- tries area codes one by one when comma-separated list is provided.
- specific handling for out-of-stock vs fatal errors.

### 7.2 DaisySMS capabilities

Implemented in `src/core/sms/providers/daisysms.js`:
- global request queue with spacing/jitter to reduce rate limits
- smart retry (up to 3) for retryable errors
- activation polling (`getStatus`) every 10s up to 7 minutes
- webhook handler support (for inbound SMS code events)
- session storage by chat/request
- cancellation API (`setStatus=8`) and automatic cancellation when requesting new location/number

### 7.3 SMSPool capabilities

Implemented in `src/core/sms/providers/smspool.js` + manager:
- purchase endpoint `/purchase/sms`
- status endpoint `/sms/check`
- cancel endpoint `/sms/cancel`
- status handling:
  - `ACTIVATING` (status 8)
  - `WAITING` (status 1)
  - `RECEIVED` (status 3 -> code extracted and sent)
- polling interval 5s, max duration 7 min
- per-chat activation lock to avoid repeated requests during activation phase

### 7.4 DaisySMS webhook server

`src/core/sms/webhook-server.js`:
- built-in HTTP server started with bot
- default port 3001, default path `/webhooks/daisysms`
- optional token auth via header/query
- routes payload to DaisySMS handler and maps code to active session

## 8) Email system feature set (AnyMessage)

Implemented in `src/core/email/anymessage.js`.

Active in full flow for Hinge-family apps:
- orders email address from AnyMessage with domain fallback:
  - first `gmail.com`, then `outlook.com`
- starts polling mailbox every 7s, max 7 min
- extracts likely verification code (4-8 digits, prefers plausible 6-7 digit)
- sends code back to chat
- can cancel email session/order

Extra behavior:
- optional email HTML preview rendering with Playwright screenshot and `sendPhoto`.
- `New Email` callback lets user regenerate email manually.
- when refreshed, Airtable links are re-sent with updated email context.

## 9) Photo system feature set

### 9.1 Pool-based delivery

Main active photo manager: `src/core/photo/pool-photo-manager.js`.

Behavior:
- app-based count:
  - Tinder: 3 photos
  - Hinge/Bumble: 6 photos
- resolves model per user (`user-models.json`) or default model
- if spoofing enabled:
  - pulls ready photos from model/app pool
  - attempts unique-original selection first
  - falls back to duplicates if needed
  - moves selected files to per-session temp dir
  - cleans mapping entries for consumed files
- if spoofing disabled:
  - copies originals directly from model source folder (no spoofing)

Delivery behavior:
- sends photos as Telegram documents (keeps original quality better than compressed photo mode)
- uses media groups in chunks (<=10) when possible
- cleanup temp files after send

### 9.2 Original filename tracking

Mapping files maintained in pool dirs:
- `.original-names.json`
- legacy `.original_names`

Used so Airtable can receive original photo names even when generated filenames are randomized.

### 9.3 Spoofers

Spoofer registry (`spoofer-registry.js`) supports:
- `random_three`
- `iphone_exif_gui_reconstructed`

Both emit `ORIGINAL_NAMES_START/END` markers that Node side parses.

### 9.4 Background stock worker

`background-photo-worker.js` continuously maintains pool stock:
- periodic stock check every 15s
- model-aware pool generation across active models
- lockfile per pool to avoid collisions between workers
- stale-lock cleanup logic
- fairness logic when multiple pools are low
- partial generation cleanup on failures

Current stock config is code-driven (not README values), with very high minimums on hinge prod pools.

### 9.5 User-model assignment

`src/core/photo/user-models.js`:
- stores user -> model key mapping in `data/user-models.json`
- supports resolving user by id or authorized name
- file watchers keep mappings synced across processes

Admin commands use this for `/setmodel`, `/changemodel`, `/listmodels`.

## 10) Airtable integration feature set

Airtable links are generated with extensive prefill fields:
- geo (lat/lon/city/state)
- proxy and proxy IP
- phone number
- email
- provider metadata (proxy provider + sms provider)
- model info
- photo original names
- software/token fields (legacy token flow support still present in code)
- Scamalytics fields (score/risk/etc)
- timestamp formatting based on Manila timezone

Forms:
- Tinder form base URL
- Hinge form base URL
- status-specific links for live/facetec/shadowban/loggedout/phonealreadyused

## 11) Admin and operational features

Admin commands implemented:
- `/addadmin <user_id>`
- `/adduser <id> <name> [--model <model>]`
- `/removeuser <id>`
- `/renameuser <id> <new_name>`
- `/listusers`
- `/setmodel <user_id|name> <model>`
- `/changemodel` (alias)
- `/listmodels`
- `/getlogs`
- `/adminhelp`

Persistence and sync:
- `data/admin_users.json`
- `data/authorized_users.json`
- filesystem watchers reload changes across running processes

Logging:
- rolling log files in `src/logs/`
- retention controls via env:
  - `LOG_MAX_DAYS`
  - `LOG_MAX_FILES`
  - `LOG_MAX_BYTES`
  - `LOG_CLEANUP_EVERY`

## 12) Data/state map (runtime + files)

Persistent files:
- `data/authorized_users.json`
- `data/admin_users.json`
- `data/user-models.json`
- location CSVs
- pool directories and original-name mappings

In-memory runtime state:
- callback payload cache for inline actions
- active proxy searches map
- SMS session maps and polling interval maps
- email session maps and polling interval maps
- token/context maps (legacy path, still present)

## 13) External services and dependencies

External APIs/services:
- Telegram Bot API
- DaisySMS
- SMSPool
- AnyMessage (email)
- Scamalytics public IP page
- Airtable forms
- api.ipify.org (IP check via proxy)

JS dependencies used in flows:
- `node-telegram-bot-api`
- `axios`
- `socks-proxy-agent`
- `@turf/turf`
- `csv-parser`
- `playwright` (email preview image)

Python side dependencies:
- from `scripts/python/requirements.txt`: `pillow`, `pillow-heif`, `numpy`, `opencv-python-headless`, `piexif`
- Scamalytics Python fallback additionally imports `curl_cffi` (not listed in `requirements.txt` currently)
- `iphone_exif_gui_reconstructed.py` expects `exiftool` available on system PATH or via `EXIFTOOL_PATH`

## 14) Security/ops observations relevant before API migration

Current codebase contains hardcoded secrets in source:
- Telegram bot tokens
- provider API keys (SMS/email)
- proxy credentials

Before exposing a public API, move all secrets to secure env/secret manager.

## 15) Code-vs-doc drift to keep in mind

Several markdown docs are outdated compared to current code:
- photo worker stock values in docs do not match current worker config
- docs mention some token-gated flows; current status buttons open forms directly
- some README command examples differ from current config set

For migration, trust runtime code paths over old docs.

## 16) API parity checklist (must-have endpoints)

To replicate the current Telegram functionality in API form, the minimum endpoint surface is:

1. `POST /accounts/generate`
- input: state/city + app + optional user/model context
- output: proxy creds, proxy ip, coordinates, phone, optional email, birthdate/zodiac, model info, photos metadata, provider metadata, artifact refs

2. `POST /proxies/regenerate`
- input: state/city + app
- output: new proxy + proxy JSON payload/file

3. `POST /phones/regenerate`
- input: area code(s) + app
- output: new number + request id + provider

4. `GET /sms/{requestId}/code` and/or webhook/callback model
- returns activation status + code when available

5. `POST /emails/regenerate` (Hinge family)
- output: new email + order id

6. `GET /emails/{orderId}/code`
- returns mailbox polling status + verification code when found

7. `POST /photos/regenerate`
- input: app + user/model
- output: new photo set refs (pool-backed), with original filename mapping

8. `GET /airtable/links`
- input: context payload + status
- output: prefilled Airtable URLs (same field mapping)

9. Admin endpoints (if API must replace admin bot features)
- users/admin CRUD
- model assignment/listing
- logs retrieval

## 17) Suggested migration order

Recommended implementation order for lower risk:
1. Extract pure services first (location/proxy/sms/email/photo/airtable link builders).
2. Build API endpoints over those services without changing behavior.
3. Add persistent session store (replace in-memory maps for multi-instance API).
4. Add webhook + async event model for SMS/email code delivery.
5. Only then retire Telegram UI layer.


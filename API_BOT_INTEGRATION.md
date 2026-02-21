# Integration Guide (Bot -> Hinge API)

This guide only covers:
- how to generate an account,
- the response format you receive,
- how to get the SMS code,
- how to get the email code.

## 1) Authentication

All `/v1/*` routes require an API key header:

```http
x-api-key: YOUR_API_KEY
```

Default local base URL:

```text
http://127.0.0.1:3000
```

---

## 2) Generate an account

### Request

`POST /v1/accounts/generate`

JSON body:

```json
{
  "state": "New York",
  "city": "New York",
  "modelKey": "chloe"
}
```

`curl` example:

```bash
curl -X POST "http://127.0.0.1:3000/v1/accounts/generate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: change-me" \
  -d '{
    "state": "New York",
    "city": "New York",
    "modelKey": "chloe"
  }'
```

### Response

This endpoint returns the formatted object directly (no `data/meta` wrapper):

```json
{
  "method": "fast_v1.01",
  "localisation": {
    "city": "New York",
    "country": "USA",
    "timezone": "America/New_York",
    "coordinates": {
      "latitude": 40.6948096,
      "longitude": -73.9293873
    }
  },
  "pictures": [
    "/.../IMG_6281.heic",
    "/.../IMG_4015.heic"
  ],
  "account_info": {
    "first_name": "Chloe",
    "last_name": "",
    "birth_date": "30-05-2006",
    "pronouns": ["she", "her"],
    "gender": "Woman",
    "sexuality": "Straight",
    "dating_preferences": ["Men"],
    "relationship_preferences": ["Monogamy"],
    "dating_intentions": "Long-term relationship",
    "height_feet": "5'4\"",
    "ethnicity": ["Hispanic/Latino"],
    "have_children": "Don't have children",
    "want_children": "Want children",
    "hometown": "",
    "workplace": "",
    "job": "",
    "school": "",
    "education_level": "High School",
    "religious_beliefs": ["Catholic"],
    "political_beliefs": "Not Political",
    "drinking_habits": "Sometimes",
    "smoking_habits": "No",
    "marijuana_use": "No",
    "drugs_use": "No",
    "prompts": [
      {
        "category": "About me",
        "prompt": "I go crazy for",
        "answer": "chocolate and dogs"
      }
    ]
  },
  "proxy_url": "domain:port:username:password",
  "phone_number": "+13472109240",
  "email": "example@gmail.com",
  "session_id": "206c80d7-d572-4c88-b531-81cf5f80b0fa",
  "sms_request_id": "513802956",
  "email_order_id": "131311536006"
}
```

Fields to keep for follow-up calls:
- `sms_request_id`
- `email_order_id`
- `session_id` (useful for other endpoints)

---

## 3) Get SMS code

### Request

`GET /v1/sms/:requestId/code`

Example:

```bash
curl "http://127.0.0.1:3000/v1/sms/513802956/code" \
  -H "x-api-key: change-me"
```

### Response

This endpoint uses the `data/meta` wrapper:

```json
{
  "data": {
    "requestId": "513802956",
    "status": "pending",
    "code": null,
    "provider": "daisysms"
  },
  "meta": {
    "requestId": "xxxx",
    "timestamp": "2026-02-21T00:00:00.000Z"
  }
}
```

When SMS arrives:
- `data.code` contains the OTP.

---

## 4) Get Email code

### Request

`GET /v1/emails/:orderId/code`

Example:

```bash
curl "http://127.0.0.1:3000/v1/emails/131311536006/code" \
  -H "x-api-key: change-me"
```

### Response

This endpoint also uses the `data/meta` wrapper:

```json
{
  "data": {
    "orderId": "131311536006",
    "status": "pending",
    "code": null,
    "provider": "anymessage"
  },
  "meta": {
    "requestId": "xxxx",
    "timestamp": "2026-02-21T00:00:00.000Z"
  }
}
```

When email OTP arrives:
- `data.code` contains the code.

---

## 5) Recommended bot flow

1. Call `POST /v1/accounts/generate`.
2. Store `sms_request_id` and `email_order_id`.
3. Poll `/v1/sms/:requestId/code` until `data.code` is available.
4. Poll `/v1/emails/:orderId/code` until `data.code` is available.

---

## 6) Status handling (pending vs terminal failure)

Use this status policy in your bot:

### Success

- `code_received`: success, stop polling.

### Pending (keep polling)

- `pending`

### Terminal failure (stop polling and fail the step)

- `cancelled`
- `expired`
- `timeout`
- `error`

Notes:
- For SMS, the API may return: `pending`, `code_received`, `cancelled`, `timeout`, `error`.
- For email, the API may return: `pending`, `code_received`, `cancelled`, `expired`, `timeout`, `error`.
- If you ever receive an unknown status, treat it as `pending` for a short grace period, then fail on client timeout.

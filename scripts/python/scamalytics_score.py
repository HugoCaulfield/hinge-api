#!/usr/bin/env python3
import json
import re
import sys
from html import unescape

try:
    from curl_cffi import requests as curl_requests
except Exception as exc:  # pragma: no cover - runtime dependency issue
    curl_requests = None
    IMPORT_ERROR = str(exc)
else:
    IMPORT_ERROR = None


def extract_geo(html: str):
    patterns = [
        (r"<(?:th|td)[^>]*>\s*City\s*</(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*</(?:th|td)>", "city"),
        (
            r"<(?:th|td)[^>]*>\s*(?:State(?:\s*/\s*Province)?|Region)\s*</(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*</(?:th|td)>",
            "state",
        ),
        (r"\bCity:\s*([^<\n\r]+)", "city"),
        (r"\b(?:State(?:\s*/\s*Province)?|Region):\s*([^<\n\r]+)", "state"),
    ]

    values = {"city": None, "state": None}
    for pattern, key in patterns:
        if values[key]:
            continue
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            values[key] = unescape(match.group(1)).strip()

    return values["city"], values["state"]


def extract_connection_type(html: str):
    patterns = [
        r"<(?:th|td)[^>]*>\s*Connection\s*Type\s*</(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*</(?:th|td)>",
        r"\bConnection\s*Type:\s*([^<\n\r]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return unescape(match.group(1)).strip().lower()
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "reason": "missing_ip"}))
        return 2

    ip = sys.argv[1].strip()
    if not ip:
        print(json.dumps({"ok": False, "reason": "empty_ip"}))
        return 2

    if curl_requests is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "curl_cffi_unavailable",
                    "errorMessage": IMPORT_ERROR,
                }
            )
        )
        return 1

    try:
        response = curl_requests.get(
            f"https://scamalytics.com/ip/{ip}",
            impersonate="chrome",
            timeout=10,
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "request_error",
                    "errorMessage": str(exc),
                }
            )
        )
        return 1

    if response.status_code != 200:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"http_{response.status_code}",
                    "statusCode": response.status_code,
                }
            )
        )
        return 1

    html = response.text or ""
    score_match = re.search(r"Fraud Score:\s*(\d+)", html, re.IGNORECASE)
    if not score_match:
        print(json.dumps({"ok": False, "reason": "score_not_found"}))
        return 1

    score = int(score_match.group(1))
    risk = "high" if score >= 75 else "medium" if score >= 35 else "low"
    city, state = extract_geo(html)
    connection_type = extract_connection_type(html)

    print(
        json.dumps(
            {
                "ok": True,
                "score": score,
                "risk": risk,
                "ispRisk": None,
                "isLowRisk": risk == "low",
                "connectionType": connection_type,
                "isDsl": connection_type == "dsl" if connection_type else None,
                "city": city,
                "state": state,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

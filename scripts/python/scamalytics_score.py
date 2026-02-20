#!/usr/bin/env python3
import json
import re
import sys
from html import unescape

from curl_cffi import requests as curl_requests


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


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "reason": "missing_ip"}))
        return 2

    ip = sys.argv[1].strip()
    if not ip:
        print(json.dumps({"ok": False, "reason": "empty_ip"}))
        return 2

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

    print(
        json.dumps(
            {
                "ok": True,
                "score": score,
                "risk": risk,
                "ispRisk": None,
                "isLowRisk": risk == "low",
                "city": city,
                "state": state,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import ipaddress
import json
import re
import subprocess
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Optional

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

import dns.exception
import dns.resolver
import requests

DEFAULT_PROXY = (
    "91.239.130.17:44445:mr88909jCof:"
    "Mkt28Uzxh5_country-gb_city-london_fast-1_stable-1_session-u6bzb7pz_lifetime-168h_ultraset-1"
)
SPAMHAUS_NS = ("a.gns.spamhaus.org", "b.gns.spamhaus.org", "c.gns.spamhaus.org")
SPAMHAUS_CODES = {
    2: "SBL",
    3: "CSS",
    4: "XBL/CBL",
    9: "DROP/EDROP",
    10: "PBL ISP",
    11: "PBL Spamhaus",
}
BLOCKING_CODES = {2, 3, 4, 9}
PBL_CODES = {10, 11}
TEST_IPS = ("180.190.7.221", "93.96.67.187")
MODE = "single"  # "single" or "test"
REQUIRE_DSL = False  # True => exit code 2 if Scamalytics connection type is not dsl
SCAM_SCRIPT = Path(__file__).resolve().parent / "scripts/python/scamalytics_score.py"


def proxy_to_requests(proxy_value: str) -> dict:
    host, port, user, password = proxy_value.split(":", 3)
    url = f"socks5://{user}:{password}@{host}:{port}"
    return {"http": url, "https": url}


def ip_from_proxy(proxy_value: str) -> str:
    response = requests.get(
        "https://httpbin.org/ip",
        proxies=proxy_to_requests(proxy_value),
        timeout=12,
    )
    response.raise_for_status()
    ip = (response.json().get("origin") or "").split(",")[0].strip()
    if ipaddress.ip_address(ip).version != 4:
        raise ValueError(f"IPv4 required, got: {ip}")
    return ip


@lru_cache(maxsize=1)
def spamhaus_resolver() -> dns.resolver.Resolver:
    bootstrap = dns.resolver.Resolver(configure=True)
    ns_ips = []
    for host in SPAMHAUS_NS:
        try:
            ns_ips.extend(a.to_text() for a in bootstrap.resolve(host, "A"))
        except dns.exception.DNSException:
            pass
    ns_ips = sorted(set(ns_ips))
    if not ns_ips:
        raise RuntimeError("Spamhaus NS resolution failed")

    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = ns_ips
    resolver.timeout = 2
    resolver.lifetime = 6
    return resolver


def classify(codes: list[int]) -> tuple[bool, str]:
    if not codes:
        return True, "clean"
    if set(codes).issubset(PBL_CODES):
        return True, "pbl_only"
    if any(code in BLOCKING_CODES for code in codes):
        return False, "listed"
    return False, "listed"


def scamalytics_via_curl_cffi(ip: str) -> Optional[dict]:
    if not SCAM_SCRIPT.exists():
        return None

    attempts = [
        ["arch", "-x86_64", "python3", str(SCAM_SCRIPT), ip],
        ["python3", str(SCAM_SCRIPT), ip],
        ["python", str(SCAM_SCRIPT), ip],
    ]
    for cmd in attempts:
        try:
            completed = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
        except Exception:
            continue

        stdout = (completed.stdout or "").strip().splitlines()
        if not stdout:
            continue
        try:
            payload = json.loads(stdout[-1])
        except json.JSONDecodeError:
            continue
        if not payload.get("ok"):
            continue

        connection_type = payload.get("connectionType")
        trust_score = payload.get("score")
        risk = payload.get("risk")
        if risk is None and isinstance(trust_score, int):
            risk = "high" if trust_score >= 75 else "medium" if trust_score >= 35 else "low"

        return {
            "connection_type": connection_type,
            "is_dsl": payload.get("isDsl")
            if payload.get("isDsl") is not None
            else (connection_type == "dsl" if connection_type else None),
            "trust_score": trust_score,
            "risk": risk,
            "status": "ok",
        }
    return None


def scamalytics_info(ip: str, proxy_value: Optional[str] = None) -> dict:
    curl_cffi_result = scamalytics_via_curl_cffi(ip)
    if curl_cffi_result is not None:
        return curl_cffi_result

    url = f"https://scamalytics.com/ip/{ip}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
    }
    attempts = [None]
    if proxy_value:
        attempts.append(proxy_to_requests(proxy_value))

    last_reason = "unavailable"
    for proxies in attempts:
        reason = "unavailable"
        try:
            response = requests.get(url, headers=headers, proxies=proxies, timeout=8)
        except requests.RequestException:
            reason = "request_error"
            last_reason = reason
            continue

        if response.status_code != 200:
            reason = f"http_{response.status_code}"
            if "Attention Required!" in response.text or "Sorry, you have been blocked" in response.text:
                reason = "cloudflare_blocked"
            last_reason = reason
            continue

        html = response.text
        match = (
            re.search(
                r"<(?:th|td)[^>]*>\s*Connection\s*Type\s*</(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*</(?:th|td)>",
                html,
                re.IGNORECASE,
            )
            or re.search(r"\bConnection\s*Type:\s*([^<\n\r]+)", html, re.IGNORECASE)
        )
        connection_type = match.group(1).strip().lower() if match else None
        score_match = re.search(r"Fraud\s*Score:\s*(\d+)", html, re.IGNORECASE)
        trust_score = int(score_match.group(1)) if score_match else None
        if trust_score is None:
            risk = None
        elif trust_score >= 75:
            risk = "high"
        elif trust_score >= 35:
            risk = "medium"
        else:
            risk = "low"

        return {
            "connection_type": connection_type,
            "is_dsl": connection_type == "dsl" if connection_type else None,
            "trust_score": trust_score,
            "risk": risk,
            "status": "ok" if (connection_type or trust_score is not None) else "empty_page",
        }

    return {
        "connection_type": None,
        "is_dsl": None,
        "trust_score": None,
        "risk": None,
        "status": last_reason,
    }


def check_spamhaus(ip: str) -> dict:
    if ipaddress.ip_address(ip).version != 4:
        raise ValueError("Spamhaus ZEN lookup requires IPv4")

    query = ".".join(reversed(ip.split("."))) + ".zen.spamhaus.org"
    records = []
    try:
        records = sorted({a.to_text() for a in spamhaus_resolver().resolve(query, "A")})
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        records = []
    except dns.exception.DNSException as exc:
        raise RuntimeError(f"DNS lookup failed for {ip}: {exc}") from exc

    codes = sorted(
        {
            int(r.split(".")[-1])
            for r in records
            if r.startswith("127.0.0.") and r.split(".")[-1].isdigit()
        }
    )
    reliable, verdict = classify(codes)
    return {
        "ip": ip,
        "results_url": f"https://check.spamhaus.org/results/?query={ip}",
        "listed": bool(codes),
        "codes": codes,
        "labels": [SPAMHAUS_CODES.get(c, f"code_{c}") for c in codes],
        "reliable": reliable,
        "verdict": verdict,
    }


def show(result: dict) -> None:
    print(f"IP: {result['ip']}")
    print(f"Spamhaus URL: {result['results_url']}")
    print(f"Listed: {result['listed']}")
    print(f"Codes: {result['codes']}")
    print(f"Labels: {result['labels']}")
    print(f"Reliable: {result['reliable']} (verdict={result['verdict']})")
    print(
        "Scamalytics connection_type: "
        f"{result['scamalytics_connection_type']} (is_dsl={result['scamalytics_is_dsl']}, status={result['scamalytics_status']})"
    )
    print(f"Scamalytics trust_score: {result['scamalytics_trust_score']} (risk={result['scamalytics_risk']})")
    print("-" * 60)


def run_test() -> int:
    results = []
    for ip in TEST_IPS:
        result = check_spamhaus(ip)
        sc = scamalytics_info(ip)
        result["scamalytics_connection_type"] = sc["connection_type"]
        result["scamalytics_is_dsl"] = sc["is_dsl"]
        result["scamalytics_trust_score"] = sc["trust_score"]
        result["scamalytics_risk"] = sc["risk"]
        result["scamalytics_status"] = sc["status"]
        results.append(result)
    print("Spamhaus test\n" + "=" * 60)
    for result in results:
        show(result)
    clean_detected = any(r["reliable"] for r in results)
    non_clean_detected = any(not r["reliable"] for r in results)
    print(f"Clean/reliable IP detected: {clean_detected}")
    print(f"Non-clean IP detected: {non_clean_detected}")
    return 0 if clean_detected and non_clean_detected else 1


def run_single() -> int:
    target_ip = ip_from_proxy(DEFAULT_PROXY)
    result = check_spamhaus(target_ip)
    sc = scamalytics_info(target_ip, DEFAULT_PROXY)
    result["scamalytics_connection_type"] = sc["connection_type"]
    result["scamalytics_is_dsl"] = sc["is_dsl"]
    result["scamalytics_trust_score"] = sc["trust_score"]
    result["scamalytics_risk"] = sc["risk"]
    result["scamalytics_status"] = sc["status"]
    print(json.dumps(result, ensure_ascii=True))
    show(result)
    if REQUIRE_DSL and result["scamalytics_is_dsl"] is not True:
        return 2
    return 0


def main() -> int:
    if MODE == "test":
        return run_test()
    return run_single()


if __name__ == "__main__":
    raise SystemExit(main())

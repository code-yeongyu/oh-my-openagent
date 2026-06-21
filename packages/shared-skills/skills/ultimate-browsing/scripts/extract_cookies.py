#!/usr/bin/env python3
"""Cross-platform browser cookie extraction for Tier-2 Chrome stealth.

The OS-keyring lookup is an injected boundary: cookie_paths resolves profile
paths and cookie_crypto derives keys + decrypts values, both pure and testable
with synthetic fixtures on any OS. This module wires them to a real browser DB
and the agent-browser CDP session.

Usage:
    python extract_cookies.py --browser chrome --domain youtube.com --output /tmp/cookies.json
    python extract_cookies.py --browser chrome --domain youtube.com --inject --cdp 9242
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from cookie_crypto import (
    decrypt_chromium_value,
    derive_key,
    linux_keyring_secret,
    macos_keyring_secret,
    windows_oscrypt_key,
)
from cookie_paths import BROWSERS, UnsupportedPlatform, platform_base, resolve_cookie_db

_SAMESITE = {-1: "None", 0: "None", 1: "Lax", 2: "Strict"}

IMPORTANT_COOKIES = {
    "SID", "SSID", "HSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
    "LOGIN_INFO", "PREF", "VISITOR_INFO1_LIVE", "YSC", "NID", "CONSENT",
}


def extract_firefox(db_path: Path, domains: list[str]) -> list[dict[str, Any]]:
    tmp = Path(tempfile.mktemp(suffix=".sqlite"))
    shutil.copy2(db_path, tmp)
    where = " OR ".join("host LIKE ?" for _ in domains)
    params = [f"%{d}%" for d in domains]
    conn = sqlite3.connect(str(tmp))
    rows = conn.execute(
        f"SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite "
        f"FROM moz_cookies WHERE ({where}) ORDER BY host, name",
        params,
    ).fetchall()
    conn.close()
    tmp.unlink(missing_ok=True)
    return [
        {
            "name": n, "value": v, "domain": h, "path": p, "expires": e,
            "secure": bool(sec), "httpOnly": bool(ho), "sameSite": _SAMESITE.get(ss, "Lax"),
        }
        for n, v, h, p, e, sec, ho, ss in rows
    ]


def extract_chromium(db_path: Path, domains: list[str], platform: str, key: bytes) -> list[dict[str, Any]]:
    tmp = Path(tempfile.mktemp(suffix=".sqlite"))
    shutil.copy2(db_path, tmp)
    where = " OR ".join("host_key LIKE ?" for _ in domains)
    params = [f"%{d}%" for d in domains]
    conn = sqlite3.connect(str(tmp))
    rows = conn.execute(
        f"SELECT name, encrypted_value, host_key, path, expires_utc, is_secure, is_httponly, samesite "
        f"FROM cookies WHERE ({where}) ORDER BY host_key, name",
        params,
    ).fetchall()
    conn.close()
    tmp.unlink(missing_ok=True)
    out = []
    for n, enc, h, p, exp, sec, ho, ss in rows:
        unix_expires = int((exp / 1_000_000) - 11644473600) if exp and exp > 0 else 0
        out.append({
            "name": n, "value": decrypt_chromium_value(platform, key, enc), "domain": h, "path": p,
            "expires": unix_expires, "secure": bool(sec), "httpOnly": bool(ho), "sameSite": _SAMESITE.get(ss, "Lax"),
        })
    return out


def default_keyring_reader(platform: str, spec: dict[str, Any]) -> Callable[[str], bytes]:
    if platform == "darwin":
        return macos_keyring_secret
    if platform == "linux":
        return linux_keyring_secret
    if platform == "win32":
        def _win(_safe_storage: str) -> bytes:
            base = platform_base("win32", "chromium")
            return windows_oscrypt_key(base / spec["dirs"]["win32"] / "Local State")
        return _win
    raise UnsupportedPlatform(f"no keyring reader for platform {platform!r}")


def extract_cookies(
    browser: str,
    domains: list[str],
    platform: str = sys.platform,
    keyring_reader: Optional[Callable[[str], bytes]] = None,
    base_override: Optional[Path] = None,
) -> list[dict[str, Any]]:
    spec = BROWSERS.get(browser)
    if spec is None:
        raise UnsupportedPlatform(f"unsupported browser: {browser!r}")
    db = resolve_cookie_db(browser, platform, base_override=base_override)
    if spec["kind"] == "firefox":
        return extract_firefox(db, domains)
    reader = keyring_reader or default_keyring_reader(platform, spec)
    key = derive_key(platform, reader(spec["safe_storage"]))
    return extract_chromium(db, domains, platform, key)


def inject_cookies(cookies: list[dict[str, Any]], cdp_port: int) -> None:
    filtered = [c for c in cookies if c["name"] in IMPORTANT_COOKIES] or cookies
    ok = 0
    for c in filtered:
        cmd = ["agent-browser", "--cdp", str(cdp_port), "cookies", "set", c["name"], c["value"]]
        for flag, value in (("--domain", c["domain"]), ("--path", c["path"])):
            if value:
                cmd += [flag, value]
        if c["secure"]:
            cmd.append("--secure")
        if c["httpOnly"]:
            cmd.append("--httpOnly")
        cmd += ["--sameSite", c.get("sameSite", "Lax")]
        if c["expires"] and int(c["expires"]) > 0:
            cmd += ["--expires", str(c["expires"])]
        if subprocess.run(cmd, capture_output=True, text=True, timeout=5).returncode == 0:
            ok += 1
    print(f"Injected {ok}/{len(filtered)} cookies into agent-browser (CDP {cdp_port})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract browser cookies (cross-platform)")
    parser.add_argument("--browser", required=True, choices=sorted(BROWSERS.keys()))
    parser.add_argument("--domain", required=True, action="append", dest="domains")
    parser.add_argument("--output", help="Write cookies JSON to file")
    parser.add_argument("--inject", action="store_true", help="Inject into agent-browser")
    parser.add_argument("--cdp", type=int, default=9242, help="CDP port (default 9242)")
    args = parser.parse_args()

    cookies = extract_cookies(args.browser, args.domains)
    print(f"Extracted {len(cookies)} cookies from {args.browser}")
    if args.output:
        Path(args.output).write_text(json.dumps(cookies, indent=2))
        print(f"Saved to {args.output}")
    if args.inject:
        inject_cookies(cookies, args.cdp)


if __name__ == "__main__":
    main()

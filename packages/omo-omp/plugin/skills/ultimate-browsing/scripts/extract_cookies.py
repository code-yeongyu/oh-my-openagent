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
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, NotRequired, TypedDict

from cookie_crypto import (
    decrypt_chromium_value,
    derive_key,
    linux_keyring_secret,
    macos_keyring_secret,
    windows_oscrypt_key,
)
from cookie_domains import domain_where_clause
from cookie_paths import BROWSERS, BrowserSpec, UnsupportedPlatform, platform_base, resolve_cookie_db

_SAMESITE = {-1: "None", 0: "None", 1: "Lax", 2: "Strict"}

IMPORTANT_COOKIES = {
    "SID", "SSID", "HSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
    "LOGIN_INFO", "PREF", "VISITOR_INFO1_LIVE", "YSC", "NID", "CONSENT",
}


class CookieRecord(TypedDict):
    name: str
    value: str
    domain: str
    path: str
    expires: int
    secure: bool
    httpOnly: bool
    sameSite: str


class CdpCookie(TypedDict):
    name: str
    value: str
    domain: str
    path: str
    secure: bool
    httpOnly: bool
    sameSite: str
    expires: NotRequired[int]


_CDP_SET_COOKIES_SCRIPT = r"""
const port = Number(process.argv[1] || 0);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("invalid CDP port\n");
  process.exit(2);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  (async () => {
  const cookies = JSON.parse(input || "[]");
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message || "CDP error"));
    else waiter.resolve(msg.result);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  let ok = 0;
  for (const cookie of cookies) {
    const result = await send("Network.setCookie", cookie);
    if (result && result.success) ok += 1;
  }
  ws.close();
  process.stdout.write(String(ok));
  })().catch((error) => {
  process.stderr.write(`${error.name || "Error"}: ${error.message || error}\n`);
  process.exit(1);
  });
});
"""


def _secure_cookie_db_copy(db_path: Path) -> Path:
    handle = tempfile.NamedTemporaryFile(prefix="omo-cookies-", suffix=".sqlite", delete=False)
    tmp = Path(handle.name)
    handle.close()
    try:
        shutil.copyfile(db_path, tmp)
        tmp.chmod(0o600)
        return tmp
    except (OSError, shutil.Error):
        tmp.unlink(missing_ok=True)
        raise


def write_cookie_file(path: Path, cookies: list[CookieRecord]) -> None:
    if path.is_symlink():
        raise ValueError(f"refusing to write cookies through symlink: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(cookies, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def extract_firefox(db_path: Path, domains: list[str]) -> list[CookieRecord]:
    tmp = _secure_cookie_db_copy(db_path)
    try:
        where, params = domain_where_clause("host", domains)
        conn = sqlite3.connect(str(tmp))
        rows = conn.execute(
            f"SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite "
            f"FROM moz_cookies WHERE ({where}) ORDER BY host, name",
            params,
        ).fetchall()
        conn.close()
    finally:
        tmp.unlink(missing_ok=True)
    return [
        {
            "name": n, "value": v, "domain": h, "path": p, "expires": e,
            "secure": bool(sec), "httpOnly": bool(ho), "sameSite": _SAMESITE.get(ss, "Lax"),
        }
        for n, v, h, p, e, sec, ho, ss in rows
    ]


def extract_chromium(db_path: Path, domains: list[str], platform: str, key: bytes) -> list[CookieRecord]:
    tmp = _secure_cookie_db_copy(db_path)
    try:
        where, params = domain_where_clause("host_key", domains)
        conn = sqlite3.connect(str(tmp))
        rows = conn.execute(
            f"SELECT name, encrypted_value, host_key, path, expires_utc, is_secure, is_httponly, samesite "
            f"FROM cookies WHERE ({where}) ORDER BY host_key, name",
            params,
        ).fetchall()
        conn.close()
    finally:
        tmp.unlink(missing_ok=True)
    out = []
    for n, enc, h, p, exp, sec, ho, ss in rows:
        unix_expires = int((exp / 1_000_000) - 11644473600) if exp and exp > 0 else 0
        out.append({
            "name": n, "value": decrypt_chromium_value(platform, key, enc), "domain": h, "path": p,
            "expires": unix_expires, "secure": bool(sec), "httpOnly": bool(ho), "sameSite": _SAMESITE.get(ss, "Lax"),
        })
    return out


def _browser_spec(browser: str) -> BrowserSpec:
    spec = BROWSERS.get(browser)
    if spec is None:
        raise UnsupportedPlatform(f"unsupported browser: {browser!r}")
    return spec


def default_keyring_reader(platform: str, spec: BrowserSpec) -> Callable[[str], bytes]:
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
    keyring_reader: Callable[[str], bytes] | None = None,
    base_override: Path | None = None,
) -> list[CookieRecord]:
    spec = _browser_spec(browser)
    db = resolve_cookie_db(browser, platform, base_override=base_override)
    if spec["kind"] == "firefox":
        return extract_firefox(db, domains)
    reader = keyring_reader or default_keyring_reader(platform, spec)
    safe_storage = spec["safe_storage"]
    if safe_storage is None:
        raise UnsupportedPlatform(f"browser {browser!r} has no keyring storage name")
    key = derive_key(platform, reader(safe_storage))
    return extract_chromium(db, domains, platform, key)


def inject_cookies(cookies: list[CookieRecord], cdp_port: int) -> None:
    filtered = [c for c in cookies if c["name"] in IMPORTANT_COOKIES] or cookies
    payload: list[CdpCookie] = [
        {
            "name": c["name"],
            "value": c["value"],
            "domain": c["domain"],
            "path": c.get("path") or "/",
            "secure": bool(c.get("secure")),
            "httpOnly": bool(c.get("httpOnly")),
            "sameSite": c.get("sameSite", "Lax"),
            **({"expires": int(c["expires"])} if c.get("expires") and int(c["expires"]) > 0 else {}),
        }
        for c in filtered
    ]
    proc = subprocess.run(
        ["node", "-e", _CDP_SET_COOKIES_SCRIPT, str(cdp_port)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "CDP cookie injection failed").strip())
    ok = int((proc.stdout or "0").strip() or "0")
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
        write_cookie_file(Path(args.output), cookies)
        print(f"Saved to {args.output}")
    if args.inject:
        inject_cookies(cookies, args.cdp)


if __name__ == "__main__":
    main()

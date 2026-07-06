#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extract_cookies import extract_cookies  # noqa: E402


def _make_chromium_db(path: Path, rows: list[tuple[str, bytes, str]]) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE cookies (name TEXT, encrypted_value BLOB, host_key TEXT, path TEXT, "
        "expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)"
    )
    conn.executemany(
        "INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?)",
        [
            (name, value, host, "/", 13_300_000_000_000_000, 1, 1, 1)
            for name, value, host in rows
        ],
    )
    conn.commit()
    conn.close()


def _make_firefox_db(path: Path, rows: list[tuple[str, str, str]]) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, "
        "expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)"
    )
    conn.executemany(
        "INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?)",
        [
            (name, value, host, "/", 9999999999, 1, 1, 1)
            for name, value, host in rows
        ],
    )
    conn.commit()
    conn.close()


class DomainFilter(unittest.TestCase):
    def _base_with_db(self, rel: str, make: Callable[[Path], None]) -> Path:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        db = base / rel
        db.parent.mkdir(parents=True)
        make(db)
        return base

    def test_chromium_does_not_overmatch_suffix_text(self) -> None:
        base = self._base_with_db(
            "Google/Chrome/User Data/Default/Cookies",
            lambda p: _make_chromium_db(
                p,
                [
                    ("exact", b"exact-value", "example.com"),
                    ("sub", b"sub-value", ".login.example.com"),
                    ("near", b"near-value", ".example.com"),
                ],
            ),
        )

        near = extract_cookies(
            "chrome", ["ample.com"], platform="win32",
            keyring_reader=lambda _s: b"k" * 32, base_override=base,
        )
        exact = extract_cookies(
            "chrome", ["example.com"], platform="win32",
            keyring_reader=lambda _s: b"k" * 32, base_override=base,
        )

        self.assertEqual(near, [])
        self.assertEqual({cookie["name"] for cookie in exact}, {"exact", "near", "sub"})

    def test_firefox_does_not_overmatch_suffix_text(self) -> None:
        base = self._base_with_db(
            "Firefox/Profiles/abc.default/cookies.sqlite",
            lambda p: _make_firefox_db(
                p,
                [
                    ("exact", "exact-value", "example.com"),
                    ("sub", "sub-value", ".login.example.com"),
                    ("near", "near-value", ".example.com"),
                ],
            ),
        )

        near = extract_cookies(
            "firefox", ["ample.com"], platform="darwin", base_override=base,
        )
        exact = extract_cookies(
            "firefox", ["example.com"], platform="darwin", base_override=base,
        )

        self.assertEqual(near, [])
        self.assertEqual({cookie["name"] for cookie in exact}, {"exact", "near", "sub"})


if __name__ == "__main__":
    unittest.main(verbosity=2)

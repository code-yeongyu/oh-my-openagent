#!/usr/bin/env python3
"""Synthetic-fixture tests for cross-platform cookie extraction (no live browser)."""
from __future__ import annotations

import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Callable
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cookie_crypto import decrypt_chromium_value, derive_key  # noqa: E402
from cookie_paths import UnsupportedPlatform, resolve_cookie_db  # noqa: E402
from extract_cookies import extract_cookies, inject_cookies, write_cookie_file  # noqa: E402


def _make_chromium_db(path: Path, name: str, encrypted_value: bytes, host: str) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE cookies (name TEXT, encrypted_value BLOB, host_key TEXT, path TEXT, "
        "expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)"
    )
    conn.execute(
        "INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?)",
        (name, encrypted_value, host, "/", 13_300_000_000_000_000, 1, 1, 1),
    )
    conn.commit()
    conn.close()


def _make_firefox_db(path: Path, name: str, value: str, host: str) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute(
        "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, "
        "expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)"
    )
    conn.execute("INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?)", (name, value, host, "/", 9999999999, 1, 1, 1))
    conn.commit()
    conn.close()


def _encrypt_cbc_v10(key: bytes, plaintext: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    data = plaintext.encode()
    pad = 16 - (len(data) % 16)
    padded = data + bytes([pad]) * pad
    encryptor = Cipher(algorithms.AES128(key), modes.CBC(b" " * 16)).encryptor()
    return b"v10" + encryptor.update(padded) + encryptor.finalize()


def _encrypt_gcm_v10(key: bytes, plaintext: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    nonce = b"n" * 12
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    ciphertext = encryptor.update(plaintext.encode()) + encryptor.finalize()
    return b"v10" + nonce + ciphertext + encryptor.tag


class PathResolution(unittest.TestCase):
    def test_macos_chromium_path(self) -> None:
        base = Path(self.tmp())
        target = base / "Google/Chrome/Default/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "darwin", base_override=base), target)

    def test_linux_chromium_network_path(self) -> None:
        base = Path(self.tmp())
        target = base / "google-chrome/Default/Network/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "linux", base_override=base), target)

    def test_windows_chromium_path(self) -> None:
        base = Path(self.tmp())
        target = base / "Google/Chrome/User Data/Default/Cookies"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"")
        self.assertEqual(resolve_cookie_db("chrome", "win32", base_override=base), target)

    def test_unsupported_platform_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            resolve_cookie_db("chrome", "sunos")

    def test_unsupported_browser_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            resolve_cookie_db("nonexistent", "darwin")

    def tmp(self) -> str:
        import tempfile

        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        return d


class KeyDerivation(unittest.TestCase):
    def test_macos_iters_differ_from_linux(self) -> None:
        secret = b"some-keychain-secret"
        self.assertNotEqual(derive_key("darwin", secret), derive_key("linux", secret))
        self.assertEqual(len(derive_key("darwin", secret)), 16)

    def test_windows_passthrough_32_bytes(self) -> None:
        key = b"k" * 32
        self.assertEqual(derive_key("win32", key), key)

    def test_windows_rejects_wrong_length(self) -> None:
        with self.assertRaises(ValueError):
            derive_key("win32", b"short")

    def test_unsupported_platform_raises(self) -> None:
        with self.assertRaises(UnsupportedPlatform):
            derive_key("sunos", b"x")


class Decryption(unittest.TestCase):
    def test_macos_cbc_roundtrip(self) -> None:
        key = derive_key("darwin", b"secret")
        blob = _encrypt_cbc_v10(key, "session-token-123")
        self.assertEqual(decrypt_chromium_value("darwin", key, blob), "session-token-123")

    def test_windows_gcm_roundtrip(self) -> None:
        key = b"k" * 32
        blob = _encrypt_gcm_v10(key, "win-token-xyz")
        self.assertEqual(decrypt_chromium_value("win32", key, blob), "win-token-xyz")


class EndToEnd(unittest.TestCase):
    def _base_with_db(self, rel: str, make: Callable[[Path], None]) -> Path:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        db = base / rel
        db.parent.mkdir(parents=True)
        make(db)
        return base

    def test_chromium_extract_with_injected_keyring(self) -> None:
        key = derive_key("darwin", b"secret")
        blob = _encrypt_cbc_v10(key, "logged-in")
        base = self._base_with_db(
            "Google/Chrome/Default/Cookies",
            lambda p: _make_chromium_db(p, "SID", blob, ".youtube.com"),
        )
        cookies = extract_cookies(
            "chrome", ["youtube.com"], platform="darwin",
            keyring_reader=lambda _s: b"secret", base_override=base,
        )
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["value"], "logged-in")
        self.assertEqual(cookies[0]["name"], "SID")

    def test_firefox_extract_unencrypted(self) -> None:
        base = self._base_with_db(
            "Firefox/Profiles/abc.default/cookies.sqlite",
            lambda p: _make_firefox_db(p, "auth", "plain-value", ".example.com"),
        )
        cookies = extract_cookies("firefox", ["example.com"], platform="darwin", base_override=base)
        self.assertEqual(len(cookies), 1)
        self.assertEqual(cookies[0]["value"], "plain-value")


class SecretHandling(unittest.TestCase):
    def test_cookie_output_file_is_owner_only(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        output = base / "cookies.json"

        write_cookie_file(output, [{"name": "SID", "value": "secret"}])

        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertIn("secret", output.read_text())

    def test_cookie_output_replaces_existing_file_only_after_private_temp_write(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        output = base / "cookies.json"
        output.write_text("old\n")
        output.chmod(0o644)

        def _dump(_cookies, f, indent: int) -> None:
            self.assertEqual(output.read_text(), "old\n")
            self.assertEqual(output.stat().st_mode & 0o777, 0o644)
            temp_files = list(base.glob(".cookies.json.*.tmp"))
            self.assertEqual(len(temp_files), 1)
            self.assertEqual(temp_files[0].stat().st_mode & 0o777, 0o600)
            f.write('[{"name": "SID", "value": "secret"}]')

        with patch("extract_cookies.json.dump", side_effect=_dump):
            write_cookie_file(output, [{"name": "SID", "value": "secret"}])

        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertIn("secret", output.read_text())

    def test_cookie_output_refuses_symlinks(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        target = base / "target.json"
        target.write_text("{}")
        link = base / "cookies.json"
        link.symlink_to(target)

        with self.assertRaises(ValueError):
            write_cookie_file(link, [{"name": "SID", "value": "secret"}])

    def test_cookie_output_refuses_dangling_symlinks(self) -> None:
        base = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(str(base), ignore_errors=True))
        link = base / "cookies.json"
        link.symlink_to(base / "missing.json")

        with self.assertRaises(ValueError):
            write_cookie_file(link, [{"name": "SID", "value": "secret"}])

    def test_inject_cookies_sends_values_over_stdin_not_argv(self) -> None:
        cookie = {
            "name": "SID",
            "value": "secret-token",
            "domain": ".youtube.com",
            "path": "/",
            "expires": 9999999999,
            "secure": True,
            "httpOnly": True,
            "sameSite": "Lax",
        }

        with patch("extract_cookies.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "1"
            run.return_value.stderr = ""

            inject_cookies([cookie], 9242)

        command = run.call_args.args[0]
        self.assertNotIn("secret-token", command)
        self.assertIn("secret-token", run.call_args.kwargs["input"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

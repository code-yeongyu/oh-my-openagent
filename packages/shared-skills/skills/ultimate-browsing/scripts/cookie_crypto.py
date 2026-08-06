"""Pure key derivation + value decryption, with the OS-keyring read injected."""
from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path

from cookie_paths import UnsupportedPlatform


def derive_key(platform: str, secret: bytes) -> bytes:
    if platform == "win32":
        if len(secret) != 32:
            raise ValueError(f"win32 os_crypt key must be 32 bytes, got {len(secret)}")
        return secret
    if platform in ("darwin", "linux"):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

        iterations = 1003 if platform == "darwin" else 1
        return PBKDF2HMAC(algorithm=hashes.SHA1(), length=16, salt=b"saltysalt", iterations=iterations).derive(secret)
    raise UnsupportedPlatform(f"unsupported platform for key derivation: {platform!r}")


def decrypt_chromium_value(platform: str, key: bytes, encrypted: bytes) -> str:
    if not encrypted:
        return ""
    prefix = encrypted[:3]
    if prefix in (b"v10", b"v11") and platform == "win32":
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        nonce, ciphertext, tag = encrypted[3:15], encrypted[15:-16], encrypted[-16:]
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        return (decryptor.update(ciphertext) + decryptor.finalize()).decode("utf-8", errors="replace")
    if prefix in (b"v10", b"v11"):
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        decryptor = Cipher(algorithms.AES128(key), modes.CBC(b" " * 16)).decryptor()
        decrypted = decryptor.update(encrypted[3:]) + decryptor.finalize()
        pad = decrypted[-1]
        if isinstance(pad, int) and 1 <= pad <= 16:
            decrypted = decrypted[:-pad]
        return decrypted.decode("utf-8", errors="replace")
    return encrypted.decode("utf-8", errors="replace")


def macos_keyring_secret(safe_storage: str) -> bytes:
    result = subprocess.run(
        ["security", "find-generic-password", "-s", safe_storage, "-w"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"cannot read {safe_storage} from Keychain: {result.stderr.strip()}")
    return result.stdout.strip().encode()


def linux_keyring_secret(safe_storage: str) -> bytes:
    try:
        import secretstorage
    except ImportError:
        return b"peanuts"
    conn = secretstorage.dbus_init()
    for item in secretstorage.get_default_collection(conn).get_all_items():
        if item.get_label() == safe_storage:
            return item.get_secret()
    return b"peanuts"


def windows_oscrypt_key(local_state_path: Path) -> bytes:
    state = json.loads(local_state_path.read_text())
    blob = base64.b64decode(state["os_crypt"]["encrypted_key"])[5:]
    import win32crypt

    return win32crypt.CryptUnprotectData(blob, None, None, None, 0)[1]

"""Pure profile-path resolution for cross-platform cookie extraction."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional


class UnsupportedPlatform(ValueError):
    """Raised when a browser/platform combination is not supported."""


BROWSERS: dict[str, dict[str, Any]] = {
    "chrome": {
        "kind": "chromium",
        "safe_storage": "Chrome Safe Storage",
        "dirs": {"darwin": "Google/Chrome", "linux": "google-chrome", "win32": "Google/Chrome/User Data"},
    },
    "brave": {
        "kind": "chromium",
        "safe_storage": "Brave Safe Storage",
        "dirs": {
            "darwin": "BraveSoftware/Brave-Browser",
            "linux": "BraveSoftware/Brave-Browser",
            "win32": "BraveSoftware/Brave-Browser/User Data",
        },
    },
    "chromium": {
        "kind": "chromium",
        "safe_storage": "Chromium Safe Storage",
        "dirs": {"darwin": "Chromium", "linux": "chromium", "win32": "Chromium/User Data"},
    },
    "firefox": {
        "kind": "firefox",
        "safe_storage": None,
        "dirs": {"darwin": "Firefox/Profiles", "linux": ".mozilla/firefox", "win32": "Mozilla/Firefox/Profiles"},
    },
}

CHROMIUM_PROFILE_DIRS = ["Default", "Profile 1", "Profile 2"]


def platform_base(platform: str, kind: str) -> Path:
    home = Path.home()
    if platform == "darwin":
        return home / "Library" / "Application Support"
    if platform == "linux":
        if kind == "firefox":
            return home
        return Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config")))
    if platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
    raise UnsupportedPlatform(f"unsupported platform: {platform!r}")


def resolve_cookie_db(browser: str, platform: str, base_override: Optional[Path] = None) -> Path:
    spec = BROWSERS.get(browser)
    if spec is None:
        raise UnsupportedPlatform(f"unsupported browser: {browser!r}")
    if platform not in spec["dirs"]:
        raise UnsupportedPlatform(f"browser {browser!r} not mapped for platform {platform!r}")

    base = base_override if base_override is not None else platform_base(platform, spec["kind"])
    profile_root = base / spec["dirs"][platform]

    if spec["kind"] == "firefox":
        if not profile_root.exists():
            raise FileNotFoundError(f"no Firefox profile root at {profile_root}")
        for entry in sorted(profile_root.iterdir()):
            db = entry / "cookies.sqlite"
            if db.exists():
                return db
        raise FileNotFoundError(f"no cookies.sqlite under {profile_root}")

    for profile in CHROMIUM_PROFILE_DIRS:
        for candidate in (profile_root / profile / "Cookies", profile_root / profile / "Network" / "Cookies"):
            if candidate.exists():
                return candidate
    raise FileNotFoundError(f"no Cookies DB under {profile_root}")

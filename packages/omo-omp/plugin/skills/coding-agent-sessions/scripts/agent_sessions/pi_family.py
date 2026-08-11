from __future__ import annotations

from pathlib import Path

from .transcript import env_path, existing, jsonl_parallel, recent, stem_id
from .types import Session

SENPI_CONFIG_DIRS = (".senpi", ".pi")
OH_MY_PI_CONFIG_DIRS = (".omp",)
GAJAE_CODE_CONFIG_DIRS = (".gjc",)

__all__ = ["scan_gajae_code", "scan_oh_my_pi", "scan_senpi"]


def scan_senpi(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_pi_family("senpi", SENPI_CONFIG_DIRS, "senpi", extra_roots, workers)


def scan_oh_my_pi(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_pi_family("oh-my-pi", OH_MY_PI_CONFIG_DIRS, "omp", extra_roots, workers)


def scan_gajae_code(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_pi_family("gajae-code", GAJAE_CODE_CONFIG_DIRS, "gjc", extra_roots, workers)


def _scan_pi_family(platform: str, config_dirs: tuple[str, ...], xdg_app: str, extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _pi_family_roots(config_dirs, xdg_app, extra_roots)
    paths = [path for root in roots for path in (root / "sessions").rglob("*.jsonl")]
    return jsonl_parallel(recent(paths), workers, platform, lambda path: stem_id(path, "_"))


def _pi_family_roots(config_dirs: tuple[str, ...], xdg_app: str, extra_roots: tuple[Path, ...]) -> list[Path]:
    home = Path.home()
    roots: list[Path] = []
    for config_dir in config_dirs:
        base = home / config_dir
        roots.append(base / "agent")
        roots.extend(sorted(base.glob("profiles/*/agent")))
    xdg_data = env_path("XDG_DATA_HOME")
    if xdg_data is not None:
        app_root = xdg_data / xdg_app
        roots.append(app_root)
        roots.extend(sorted(app_root.glob("profiles/*")))
    roots.extend(extra_roots)
    return existing(roots)

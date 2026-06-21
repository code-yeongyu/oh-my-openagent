#!/usr/bin/env python3
"""No-Site-Name Rule checker.

Run in CI / pre-commit. Scans engine/** for hard-coded site names or
domains that would bias the generic fetch chain toward one site.

Exit code 0 if clean, 1 if violations found.

    python3 engine/bias_check.py
    python3 engine/bias_check.py --strict    # also check references/*.md (usually off)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


# Known brand / domain substrings that should NOT appear in engine code.
# This is a non-exhaustive deny list. CI should treat hits as warnings that
# require human review; false positives (e.g. "github" in comments) can be
# whitelisted via EXPLICIT_ALLOW.
BRAND_SUBSTRINGS = [
    "coupang", "11st", "11번가", "musinsa", "무신사",
    "fmkorea", "에펨코리아", "dcinside", "디시인사이드",
    "ohou", "오늘의집", "kurly", "마켓컬리",
    "daangn", "당근",
    # Naver is allowed in Phase 0 references (official APIs) but not in engine code.
    "naver.com", "blog.naver", "shopping.naver",
    # Korean portal brand names
    "daum.net", "kakao.com",
]

# Regex for bare URLs / domains. Used as a secondary pass to flag hardcoded
# site hosts that slipped past the brand denylist.
URL_PATTERN = re.compile(
    r"https?://[\w\.-]+|[\w-]+\.(?:com|net|org|co\.kr|kr|io)\b",
    re.IGNORECASE,
)

# Generic / neutral hosts that are allowed anywhere (examples, specs, stdlib,
# and domains that legitimately appear as non-site-specific referrers / test
# fixtures — Google search as a generic Referer strategy, httpbin for transport
# tests, etc.). Anything in this set must be provably unrelated to a specific
# target-site preference.
URL_ALLOWLIST = {
    "example.com", "example.org", "example.net",
    "localhost", "127.0.0.1",
    # Official API / documentation sources cited in code comments.
    "curl.se", "playwright.dev", "nodejs.org", "npmjs.com",
    # Generic Referer strategy target (used as a neutral off-site referer).
    "www.google.com", "google.com",
    # Generic HTTP test endpoint for infrastructure / transport tests.
    "httpbin.org",
}

# Files / dirs that must be clean.
SCAN_ROOTS_STRICT_OFF = ["engine"]
SCAN_ROOTS_STRICT_ON = ["engine", "references"]

# Directory names skipped during scan (third-party code, build artefacts).
EXCLUDED_DIR_NAMES = {
    "node_modules", "__pycache__", ".git", ".venv", "dist", "build",
}

# Comment markers within which a brand mention is OK (explanation).
# Keyed per-extension; any line containing these is skipped.
COMMENT_OK_MARKERS = {
    ".py": ("# NOTE-BIAS-OK", "# EXAMPLE-ONLY"),
    ".js": ("// NOTE-BIAS-OK", "// EXAMPLE-ONLY"),
    ".yaml": ("# NOTE-BIAS-OK", "# EXAMPLE-ONLY"),
    ".yml": ("# NOTE-BIAS-OK", "# EXAMPLE-ONLY"),
    ".md": ("<!-- NOTE-BIAS-OK -->", "<!-- EXAMPLE-ONLY -->"),
}

# File paths explicitly exempted (full match against relative path from scan root).
EXPLICIT_ALLOW_FILES = {
    # None right now — add if needed with justification.
}


def _line_is_exempt(line: str, ext: str) -> bool:
    markers = COMMENT_OK_MARKERS.get(ext, ())
    return any(m in line for m in markers)


def _scan_file(path: Path, root: Path) -> list[str]:
    """Return list of violation strings for this file."""
    rel = path.relative_to(root.parent)
    if str(rel) in EXPLICIT_ALLOW_FILES:
        return []

    ext = path.suffix.lower()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        return [f"{rel}:0 — read error: {e}"]

    violations: list[str] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if _line_is_exempt(line, ext):
            continue
        lowered = line.lower()
        # 1) Brand / domain denylist
        hit_brand = None
        for brand in BRAND_SUBSTRINGS:
            if brand.lower() in lowered:
                hit_brand = brand
                break
        if hit_brand:
            violations.append(f"{rel}:{lineno} — brand `{hit_brand}` in: {line.strip()[:120]}")
            continue  # one violation per line
        # 2) URL/domain regex scan — catches hosts that aren't in the denylist.
        for match in URL_PATTERN.finditer(line):
            host = match.group(0).lower()
            host = host.split("//", 1)[-1].split("/", 1)[0]
            if host in URL_ALLOWLIST:
                continue
            if host.endswith(".example.com") or host.endswith(".example.org"):
                continue
            violations.append(f"{rel}:{lineno} — hardcoded host `{host}` in: {line.strip()[:120]}")
            break
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan engine for site-name bias")
    parser.add_argument("--strict", action="store_true",
                        help="Also scan references/*.md (usually noisy — off by default)")
    parser.add_argument("--root", default=None,
                        help="Skill root directory. Defaults to parent of this file.")
    args = parser.parse_args(argv)

    skill_root = Path(args.root) if args.root else Path(__file__).parent.parent
    scan_roots = SCAN_ROOTS_STRICT_ON if args.strict else SCAN_ROOTS_STRICT_OFF

    total_violations: list[str] = []
    scanned = 0
    for name in scan_roots:
        root = skill_root / name
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            # In-place filter so os.walk skips these subtrees.
            dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIR_NAMES]
            for fname in filenames:
                p = Path(dirpath) / fname
                if p.suffix.lower() not in (".py", ".js", ".yaml", ".yml", ".md", ".ts", ".mjs"):
                    continue
                if p.name == "bias_check.py":
                    continue  # self-exempt (this file lists the brands)
                scanned += 1
                total_violations.extend(_scan_file(p, skill_root))

    print(f"[bias-check] scanned {scanned} files under {skill_root}")
    if total_violations:
        print(f"[bias-check] ❌ {len(total_violations)} violation(s):")
        for v in total_violations:
            print(f"  - {v}")
        print()
        print("Fix options:")
        print("  1) Remove the brand name (preferred)")
        print("  2) If genuinely explanatory, add '# NOTE-BIAS-OK' on the same line")
        print("  3) If this is a Phase 0 official API reference, move it to references/*.md and rerun without --strict")
        return 1

    print("[bias-check] ✅ clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""CLI entrypoint for the insane-search engine.

Usage:
    python3 -m engine URL [--selector CSS] [--device auto|desktop|mobile]
                          [--timeout N] [--max-attempts N] [--json] [--trace]

Examples:
    python3 -m engine "https://example.com/" --selector "h1"
    python3 -m engine "https://example.com/" --json
    python3 -m engine "https://example.com/" --device mobile --trace

Exit codes:
    0   strong_ok or weak_ok
    1   ok=False (all attempts failed)
    2   CLI arg error
"""
from __future__ import annotations

import argparse
import json
import sys

from . import fetch


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python3 -m engine",
                                description="Generic WAF-profile fetch chain.")
    p.add_argument("url", help="URL to fetch.")
    p.add_argument("--selector", "-s", action="append", default=None,
                   dest="selectors", metavar="CSS",
                   help="Positive-proof CSS selector. Repeatable.")
    p.add_argument("--device", choices=("auto", "desktop", "mobile"), default="auto",
                   help="Device class pin.")
    p.add_argument("--timeout", type=int, default=25,
                   help="Per-attempt timeout seconds (default 25).")
    p.add_argument("--max-attempts", type=int, default=12,
                   help="Upper bound across all phases (default 12).")
    p.add_argument("--no-playwright", action="store_true",
                   help="Skip Playwright fallback (curl-only).")
    p.add_argument("--json", action="store_true",
                   help="Emit FetchResult as JSON to stdout (content omitted).")
    p.add_argument("--trace", action="store_true",
                   help="Print per-attempt trace to stderr.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = fetch(
            args.url,
            success_selectors=args.selectors,
            device_class=args.device,
            timeout=args.timeout,
            max_attempts=args.max_attempts,
            enable_playwright=not args.no_playwright,
        )
    except Exception as e:
        print(f"engine fatal: {type(e).__name__}: {e}", file=sys.stderr)
        return 2

    if args.trace:
        print("=== trace ===", file=sys.stderr)
        for att in result.trace:
            d = att.to_dict()
            imp = d.get("impersonate") or "-"
            ref = d.get("referer") or "-"
            print(
                f"[{d['phase']:<8}] {d['executor']:<18} "
                f"xform={d['url_transform']:<16} imp={imp:<14} ref={ref:<14} "
                f"status={d['status']:>4} size={d['body_size']:>8} "
                f"verdict={d['verdict']} {('err=' + d['error'][:60]) if d.get('error') else ''}",
                file=sys.stderr,
            )
        print(f"=== summary: {result.summary} ===", file=sys.stderr)

    # Surface R7 hint (API-first route) prominently when summary contains it,
    # regardless of --trace flag — this is actionable guidance, not noise.
    if "R7 API-first" in (result.summary or ""):
        print(
            "\n════════════════════════════════════════════════════════════════\n"
            "⚠️  R7 triggered — consider API-first route instead of HTML grid.\n"
            "   See summary below (or re-run with --trace for full attempt log).\n"
            "════════════════════════════════════════════════════════════════",
            file=sys.stderr,
        )
        # Also print the full summary (which includes the hint) so caller sees it.
        print(result.summary, file=sys.stderr)

    if args.json:
        payload = result.to_dict()
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        # Default: HTML to stdout, status to stderr.
        print(result.content, end="")
        print(f"\n[engine] ok={result.ok} verdict={result.verdict} "
              f"profile={result.profile_used} attempts={len(result.trace)}",
              file=sys.stderr)

    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())

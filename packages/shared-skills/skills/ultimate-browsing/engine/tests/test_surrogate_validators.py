"""Surrogate-tier validation tests; fixtures only, never live network, so the suite cannot flake."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.result_schema import FetchResult  # noqa: E402
from engine.validators import Verdict, validate  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


class _Resp:
    def __init__(self, text: str = "", status: int = 200, url: str = ""):
        self.text = text
        self.status_code = status
        self.url = url
        self.cookies = {}
        self.headers = {}


class RedirectStubRejection(unittest.TestCase):
    def test_amp_redirect_stub_is_not_ok(self) -> None:
        body = _fixture("amp_redirect_stub.html")
        self.assertLess(len(body), 1000)
        resp = _Resp(body, 200, "https://en-wikipedia-org.cdn.ampproject.org/c/s/x")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        vr = validate(resp, target_url="https://en.wikipedia.org/wiki/Web_archiving")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        self.assertIn(vr.verdict, (Verdict.CHALLENGE, Verdict.UNKNOWN))
        self.assertFalse(vr.ok)

    def test_real_snapshot_still_passes(self) -> None:
        resp = _Resp(_fixture("wayback_snapshot.html"), 200, "https://web.archive.org/web/2024/x")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        vr = validate(resp, target_url="https://en.wikipedia.org/wiki/Web_archiving")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        self.assertTrue(vr.ok)

    def test_plain_page_still_weak_ok(self) -> None:
        resp = _Resp("<html><body>" + ("x" * 4000) + "</body></html>", 200, "https://example.com/")
        vr = validate(resp, target_url="https://example.com/")
        self.assertTrue(vr.ok)


class InterstitialRejection(unittest.TestCase):
    def test_search_engine_interstitial_is_not_ok(self) -> None:
        body = _fixture("search_interstitial.html")
        resp = _Resp(body, 200, "https://webcache.googleusercontent.com/search?q=cache:x")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        vr = validate(resp, target_url="https://en.wikipedia.org/wiki/Web_archiving")  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        self.assertIn(vr.verdict, (Verdict.CHALLENGE, Verdict.UNKNOWN))
        self.assertFalse(vr.ok)


class ResultSchemaProvenance(unittest.TestCase):
    def test_defaults_are_live_origin(self) -> None:
        r = FetchResult(ok=True)
        self.assertEqual(r.provenance, "live")
        self.assertEqual(r.trust, "origin")
        self.assertIsNone(r.snapshot_timestamp)
        d = r.to_dict()
        self.assertEqual(d["provenance"], "live")
        self.assertEqual(d["trust"], "origin")
        self.assertIn("snapshot_timestamp", d)

    def test_snapshot_fields_roundtrip(self) -> None:
        r = FetchResult(ok=True, provenance="snapshot", snapshot_timestamp="20241227132135", trust="archive")
        d = r.to_dict()
        self.assertEqual(d["provenance"], "snapshot")
        self.assertEqual(d["snapshot_timestamp"], "20241227132135")
        self.assertEqual(d["trust"], "archive")


if __name__ == "__main__":
    unittest.main()

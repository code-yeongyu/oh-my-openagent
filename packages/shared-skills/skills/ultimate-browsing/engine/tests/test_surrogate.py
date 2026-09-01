"""Surrogate registry/fetch/ordering tests; registry entries and responses are faked, never live network."""
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.result_schema import Attempt  # noqa: E402
from engine.validators import Verdict  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
TARGET = "https://en.wikipedia.org/wiki/Web_archiving"  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


class _Resp:
    def __init__(self, text: str = "", status: int = 200, url: str = "", payload: dict | None = None):
        self.text = text
        self.status_code = status
        self.url = url
        self.cookies = {}
        self.headers = {}
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no json payload")
        return self._payload


def _fail_attempt(phase: str) -> Attempt:
    return Attempt(
        phase=phase,
        executor="curl_cffi",
        url=TARGET,
        url_transform="original",
        impersonate="safari",
        referer="self_root",
        verdict=Verdict.CHALLENGE.value,
    )


class SurrogateRegistry(unittest.TestCase):
    def test_default_registry_contains_wayback(self) -> None:
        from engine import surrogate

        reg = surrogate.load_surrogates()
        self.assertIn("wayback", reg)
        self.assertEqual(reg["wayback"]["kind"], "archive")
        self.assertEqual(reg["wayback"]["trust"], "archive")

    def test_stale_entries_detected(self) -> None:
        from engine import surrogate

        self.assertTrue(surrogate.is_stale({"last_verified": "2025-01-01"}, max_age_days=90))
        self.assertFalse(surrogate.is_stale({"last_verified": "2999-01-01"}, max_age_days=90))


class SurrogateFetch(unittest.TestCase):
    def test_wayback_success_sets_snapshot_provenance(self) -> None:
        from engine import surrogate

        discovery = json.loads(_fixture("wayback_available.json"))

        def fake_http(u: str, **kw):
            if "wayback/available" in u:
                return _Resp(json.dumps(discovery), 200, u, payload=discovery)
            return _Resp(_fixture("wayback_snapshot.html"), 200, u)

        with patch.object(surrogate, "_http_get", side_effect=fake_http):
            atts, meta, content = surrogate.run_surrogate(TARGET, registry=surrogate.load_surrogates(), timeout=5)

        att = atts[-1]
        self.assertEqual(att.phase, "surrogate")
        self.assertEqual(att.executor, "surrogate_wayback")
        self.assertEqual(att.verdict, Verdict.WEAK_OK.value)
        self.assertEqual(meta["provenance"], "snapshot")
        self.assertTrue(meta["snapshot_timestamp"])
        self.assertEqual(meta["trust"], "archive")
        self.assertGreater(len(content), 3000)

    def test_stub_snapshot_is_not_accepted(self) -> None:
        from engine import surrogate

        disc = {"archived_snapshots": {"closest": {"available": True, "url": "https://web.archive.org/web/2024/x", "timestamp": "20240101000000"}}}  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site

        def fake_http(u: str, **kw):
            if "wayback/available" in u:
                return _Resp(json.dumps(disc), 200, u, payload=disc)
            return _Resp(_fixture("amp_redirect_stub.html"), 200, u)

        with patch.object(surrogate, "_http_get", side_effect=fake_http):
            atts, _, _ = surrogate.run_surrogate(TARGET, registry={"wayback": surrogate.DEFAULT_SURROGATES["wayback"]}, timeout=5)
        att = atts[-1]
        self.assertNotIn(att.verdict, (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value))

    def test_proxy_skips_without_allow_flag(self) -> None:
        from engine import surrogate

        reg = {"anon_relay": {"kind": "proxy", "trust": "untrusted", "enabled": False,
                              "last_verified": "2999-01-01", "fetch": "https://relay.invalid/{target}"}}  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        called: list[str] = []

        with patch.object(surrogate, "_http_get", side_effect=lambda u, **kw: (called.append(u), _Resp("<html>" + "y" * 4000 + "</html>", 200, u))[1]):
            atts, _, _ = surrogate.run_surrogate(TARGET, registry=reg, allow_proxy=False, timeout=5)
        self.assertEqual(len(called), 0)

        with patch.object(surrogate, "_http_get", side_effect=lambda u, **kw: (called.append(u), _Resp("<html>" + "y" * 4000 + "</html>", 200, u))[1]):
            atts, meta, _ = surrogate.run_surrogate(TARGET, registry=reg, allow_proxy=True, timeout=5)
        self.assertEqual(len(called), 1)
        att = atts[-1]
        self.assertEqual(att.executor, "surrogate_anon_relay")
        self.assertEqual(meta["trust"], "untrusted")

    def test_proxy_never_carries_credentials(self) -> None:
        from engine import surrogate

        seen: list[dict] = []

        def fake_http(u: str, **kw):
            seen.append(kw.get("headers", {}))
            return _Resp("<html>" + "z" * 4000 + "</html>", 200, u)

        reg = {"anon_relay": {"kind": "proxy", "trust": "untrusted", "enabled": False,
                              "last_verified": "2999-01-01", "fetch": "https://relay.invalid/{target}"}}  # NOTE-BIAS-OK — fixture URL from a third-party surrogate service, not a target site
        os.environ["OMOB_TEST_TOKEN"] = "secret"
        try:
            with patch.object(surrogate, "_http_get", side_effect=fake_http):
                surrogate.run_surrogate(TARGET, registry=reg, allow_proxy=True, timeout=5)
        finally:
            os.environ.pop("OMOB_TEST_TOKEN", None)

        self.assertEqual(len(seen), 1)
        joined = json.dumps(seen[0]).lower()
        self.assertNotIn("secret", joined)
        self.assertNotIn("authorization", joined)
        self.assertNotIn("cookie", joined)


class ChainOrdering(unittest.TestCase):
    def _profile(self) -> dict:
        return {
            "tls_impersonate_candidates": [[]],
            "referer_strategies": [],
            "url_transform_order": ["original"],
            "fallback_when_challenge": ["surrogate_wayback", "playwright_real_chrome"],
        }

    def test_surrogate_success_short_circuits_playwright(self) -> None:
        from engine.fetch_chain import fetch
        from engine import surrogate
        from engine import executor as ex

        def fake_surrogate(*a, **kw):
            att = Attempt(
                phase="surrogate",
                executor="surrogate_wayback",
                url=TARGET,
                url_transform="original",
                impersonate=None,
                referer="",
                verdict=Verdict.WEAK_OK.value,
                body_size=5000,
            )
            return [att], {"provenance": "snapshot", "snapshot_timestamp": "20240101000000", "trust": "archive"}, "<html>content</html>"

        def fail_playwright(*a, **kw):
            raise AssertionError("playwright must not run after surrogate success")

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", side_effect=lambda *a, **kw: (_fail_attempt(str(kw.get("phase", "grid"))), None)), \
                patch("engine.fetch_chain.detect", return_value=[]), \
                patch("engine.fetch_chain.load_profile", side_effect=lambda *a, **kw: self._profile()), \
                patch.object(surrogate, "run_surrogate", side_effect=fake_surrogate), \
                patch.object(ex, "run_playwright_fallback", side_effect=fail_playwright):
            result = fetch(TARGET, enable_playwright=True, max_attempts=1)

        self.assertTrue(result.ok)
        self.assertEqual(result.provenance, "snapshot")
        self.assertEqual(result.snapshot_timestamp, "20240101000000")

    def test_surrogate_still_runs_when_playwright_disabled(self) -> None:
        from engine.fetch_chain import fetch
        from engine import surrogate

        calls: list[str] = []

        def fake_surrogate(*a, **kw):
            calls.append("surrogate")
            att = Attempt(phase="surrogate", executor="surrogate_wayback", url=TARGET,
                          url_transform="original", impersonate=None, referer="",
                          verdict=Verdict.WEAK_OK.value, body_size=5000)
            return [att], {"provenance": "snapshot", "snapshot_timestamp": "20240101000000", "trust": "archive"}, "<html>snap</html>"

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", side_effect=lambda *a, **kw: (_fail_attempt(str(kw.get("phase", "grid"))), None)), \
                patch("engine.fetch_chain.detect", return_value=[]), \
                patch("engine.fetch_chain.load_profile", side_effect=lambda *a, **kw: self._profile()), \
                patch.object(surrogate, "run_surrogate", side_effect=fake_surrogate):
            result = fetch(TARGET, enable_playwright=False, max_attempts=1)

        self.assertEqual(calls, ["surrogate"])
        self.assertTrue(result.ok)
        self.assertEqual(result.provenance, "snapshot")

    def test_playwright_runs_when_surrogate_fails(self) -> None:
        from engine.fetch_chain import fetch
        from engine import surrogate
        from engine import executor as ex

        calls: list[str] = []

        def fake_surrogate(*a, **kw):
            calls.append("surrogate")
            att = Attempt(phase="surrogate", executor="surrogate_wayback", url=TARGET,
                          url_transform="original", impersonate=None, referer="",
                          verdict=Verdict.UNKNOWN.value)
            return [att], {"provenance": "live", "snapshot_timestamp": None, "trust": "origin"}, ""

        def fake_playwright(*a, **kw):
            calls.append("playwright")
            att = Attempt(phase="fallback", executor="playwright_real_chrome", url=TARGET,
                          url_transform="original", impersonate=None, referer="",
                          verdict=Verdict.WEAK_OK.value, body_size=5000)
            return att, "<html>chrome content</html>"

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", side_effect=lambda *a, **kw: (_fail_attempt(str(kw.get("phase", "grid"))), None)), \
                patch("engine.fetch_chain.detect", return_value=[]), \
                patch("engine.fetch_chain.load_profile", side_effect=lambda *a, **kw: self._profile()), \
                patch.object(surrogate, "run_surrogate", side_effect=fake_surrogate), \
                patch.object(ex, "run_playwright_fallback", side_effect=fake_playwright):
            result = fetch(TARGET, enable_playwright=True, max_attempts=1)

        self.assertTrue(result.ok)
        self.assertEqual(result.provenance, "live")
        self.assertEqual(calls, ["surrogate", "playwright"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.fetch_chain import fetch  # noqa: E402
from engine.result_schema import Attempt  # noqa: E402
from engine.validators import Verdict  # noqa: E402


class _Resp:
    def __init__(self, text: str = "<article>ok</article>", url: str = "https://example.com/"):
        self.text = text
        self.url = url


class _Hit:
    profile_id = "cloudflare_turnstile"
    confidence = 1.0
    signals = ["test"]


class FetchChain(unittest.TestCase):
    def test_probe_success_returns_without_grid(self) -> None:
        attempt = Attempt(
            phase="probe",
            executor="curl_cffi",
            url="https://example.com",
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.WEAK_OK.value,
        )

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(attempt, _Resp())) as run_attempt:
            result = fetch("https://example.com", enable_playwright=False)

        self.assertTrue(result.ok)
        self.assertEqual(result.verdict, Verdict.WEAK_OK.value)
        self.assertEqual(len(result.trace), 1)
        self.assertEqual(run_attempt.call_count, 1)

    def test_max_attempts_stops_after_probe_before_grid(self) -> None:
        attempt = Attempt(
            phase="probe",
            executor="curl_cffi",
            url="https://example.com",
            url_transform="original",
            impersonate="safari",
            referer="self_root",
            verdict=Verdict.CHALLENGE.value,
        )

        with patch("engine.fetch_chain._load_profiles", return_value={}), \
                patch("engine.fetch_chain.last_load_error", return_value=None), \
                patch("engine.fetch_chain.run_attempt", return_value=(attempt, _Resp("blocked"))), \
                patch("engine.fetch_chain.detect", return_value=[_Hit()]), \
                patch("engine.fetch_chain.load_profile", return_value={
                    "tls_impersonate_candidates": [["chrome"]],
                    "referer_strategies": ["self_root"],
                    "url_transform_order": ["original"],
                }):
            result = fetch("https://example.com", max_attempts=1, enable_playwright=False)

        self.assertFalse(result.ok)
        self.assertEqual(len(result.trace), 1)
        self.assertEqual(result.trace[0].phase, "probe")


if __name__ == "__main__":
    unittest.main()

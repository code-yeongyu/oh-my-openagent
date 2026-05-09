"""Unit tests for team-pane-live-tail.py renderer helpers.

Run: python3 -m unittest script/test_team_pane_live_tail.py
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SCRIPT_PATH = HERE / "team-pane-live-tail.py"

spec = importlib.util.spec_from_file_location("team_pane_live_tail", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
sys.modules["team_pane_live_tail"] = mod
spec.loader.exec_module(mod)


class ExtractTaskLineTests(unittest.TestCase):
    def test_skips_kickoff_metadata_headers(self) -> None:
        text = (
            "Team: omc-enhancement-team\n"
            "TeamRunId: 59704820-c9d5-4ff9-8490-81f17040a982\n"
            "Member: docs-auditor\n"
            "Audit all AGENTS.md files for alignment with hooks.\n\n"
            "# Team Communication\n\n"
            "You are running as a team member..."
        )
        self.assertEqual(
            mod.extract_task_line(text),
            "Audit all AGENTS.md files for alignment with hooks.",
        )

    def test_returns_first_real_body_line_when_no_metadata(self) -> None:
        self.assertEqual(
            mod.extract_task_line("Just a single task description"),
            "Just a single task description",
        )

    def test_returns_empty_when_only_metadata_and_section_headers(self) -> None:
        text = (
            "Team: x\n"
            "TeamRunId: y\n"
            "Member: z\n"
            "# Team Communication\n"
            "boilerplate"
        )
        self.assertEqual(mod.extract_task_line(text), "")

    def test_strips_leading_whitespace(self) -> None:
        self.assertEqual(mod.extract_task_line("    indented task"), "indented task")


class SummarizePeerMessageTests(unittest.TestCase):
    def test_compresses_full_peer_message(self) -> None:
        text = (
            '<peer_message from="lead" timestamp="123" messageId="abc">'
            "Status check please.\nMore detail here.</peer_message>"
        )
        result = mod.summarize_peer_message(text)
        self.assertIsNotNone(result)
        self.assertIn("⇠ peer from lead:", result)
        self.assertIn("Status check please", result)

    def test_returns_none_for_non_peer_text(self) -> None:
        self.assertIsNone(mod.summarize_peer_message("regular assistant output"))

    def test_returns_none_for_malformed_xml(self) -> None:
        self.assertIsNone(mod.summarize_peer_message('<peer_message from="lead">unclosed'))


class AccentForTests(unittest.TestCase):
    def test_deterministic_per_session(self) -> None:
        a1 = mod.accent_for("ses_abc")
        a2 = mod.accent_for("ses_abc")
        self.assertEqual(a1, a2)

    def test_different_sessions_can_get_different_colours(self) -> None:
        # Picks two ids that differ in their character-sum modulo the ramp.
        first = mod.accent_for("ses_aaaaa")
        second = mod.accent_for("ses_aaaab")
        self.assertNotEqual(first, second)


class SessionStateUrlNormalizationTests(unittest.TestCase):
    """OmO's tmuxMgr.getServerUrl() emits trailing-slash URLs; without
    normalisation the script issues `http://.../4096//session/...` which
    OpenCode rejects with an empty body. Regression test for that bug."""

    def test_strips_single_trailing_slash(self) -> None:
        s = mod.SessionState("http://127.0.0.1:4096/", "ses_x")
        self.assertEqual(s.url, "http://127.0.0.1:4096")

    def test_strips_multiple_trailing_slashes(self) -> None:
        s = mod.SessionState("http://127.0.0.1:4096///", "ses_x")
        self.assertEqual(s.url, "http://127.0.0.1:4096")

    def test_leaves_url_without_trailing_slash_alone(self) -> None:
        s = mod.SessionState("http://127.0.0.1:4096", "ses_x")
        self.assertEqual(s.url, "http://127.0.0.1:4096")

    def test_uses_unverified_context_only_when_insecure_enabled(self) -> None:
        strict = mod.SessionState("https://127.0.0.1:4096", "ses_strict")
        insecure = mod.SessionState("https://127.0.0.1:4096", "ses_insecure", insecure=True)
        self.assertEqual(strict.ssl_context.verify_mode, mod.ssl.CERT_REQUIRED)
        self.assertEqual(insecure.ssl_context.verify_mode, mod.ssl.CERT_NONE)


class SessionStateFetchTests(unittest.TestCase):
    def _mock_session_response(self, payload: dict) -> patch:
        body = json.dumps(payload).encode("utf-8")

        class _Resp:
            def __init__(self, b: bytes) -> None:
                self._b = b

            def __enter__(self) -> "_Resp":
                return self

            def __exit__(self, *a: object) -> None:
                pass

            def read(self) -> bytes:
                return self._b

        return patch.object(mod.urllib.request, "urlopen", return_value=_Resp(body))

    def test_parses_team_member_agent_from_title(self) -> None:
        state = mod.SessionState("http://x", "ses_y")
        with self._mock_session_response({
            "title": "Create team member omc-team/docs-auditor (@Sisyphus-Junior subagent)",
        }):
            # Wrap urlopen so json.load works on a file-like; patch json.load to
            # decode bytes directly.
            with patch.object(mod.json, "load", side_effect=lambda r: json.loads(r.read())):
                state.fetch()
        self.assertEqual(state.team_name, "omc-team")
        self.assertEqual(state.member_name, "docs-auditor")
        self.assertEqual(state.agent, "Sisyphus-Junior")

    def test_falls_back_to_truncated_title_when_pattern_misses(self) -> None:
        state = mod.SessionState("http://x", "ses_y")
        with self._mock_session_response({"title": "ad-hoc title not matching pattern"}):
            with patch.object(mod.json, "load", side_effect=lambda r: json.loads(r.read())):
                state.fetch()
        self.assertEqual(state.member_name, "ad-hoc title not matching pattern")
        self.assertEqual(state.team_name, "")


class HandleEventTests(unittest.TestCase):
    def test_user_role_text_renders_as_user(self) -> None:
        state = mod.SessionState("http://x", "ses_y")
        state.role_by_message["msg1"] = "USER"
        seen: dict = {}
        ev = {
            "type": "message.part.updated",
            "properties": {
                "part": {
                    "type": "text",
                    "id": "p1",
                    "messageID": "msg1",
                    "text": "Hello there",
                },
            },
        }
        with patch("sys.stdout", new=StringIO()) as fake:
            mod.handle_event(ev, state, seen)
        self.assertIn("USER", fake.getvalue())
        self.assertNotIn("ASSISTANT", fake.getvalue())

    def test_assistant_role_default_when_unknown(self) -> None:
        state = mod.SessionState("http://x", "ses_y")
        seen: dict = {}
        ev = {
            "type": "message.part.updated",
            "properties": {
                "part": {
                    "type": "text",
                    "id": "p1",
                    "messageID": "unknown",
                    "text": "Streaming response",
                },
            },
        }
        with patch("sys.stdout", new=StringIO()) as fake:
            mod.handle_event(ev, state, seen)
        self.assertIn("ASSISTANT", fake.getvalue())

    def test_dedupes_growing_text_streams(self) -> None:
        state = mod.SessionState("http://x", "ses_y")
        seen: dict = {}
        first = {
            "type": "message.part.updated",
            "properties": {"part": {"type": "text", "id": "p1", "messageID": "m", "text": "Hello"}},
        }
        same_size = {
            "type": "message.part.updated",
            "properties": {"part": {"type": "text", "id": "p1", "messageID": "m", "text": "Hello"}},
        }
        with patch("sys.stdout", new=StringIO()) as fake:
            mod.handle_event(first, state, seen)
            mod.handle_event(same_size, state, seen)
        # Only one render despite two events of the same length.
        self.assertEqual(fake.getvalue().count("Hello"), 1)


class MatchSessionTests(unittest.TestCase):
    def test_matches_via_part_sessionID(self) -> None:
        ev = {"properties": {"part": {"sessionID": "ses_abc"}}}
        self.assertTrue(mod.match_session(ev, "ses_abc"))

    def test_matches_via_info_sessionID(self) -> None:
        ev = {"properties": {"info": {"sessionID": "ses_abc"}}}
        self.assertTrue(mod.match_session(ev, "ses_abc"))

    def test_rejects_other_session(self) -> None:
        ev = {"properties": {"info": {"sessionID": "ses_other"}}}
        self.assertFalse(mod.match_session(ev, "ses_abc"))


class ReconnectWallclockBudgetTests(unittest.TestCase):
    def test_reconnect_exits_after_wallclock_budget(self) -> None:
        import time as _time

        state = mod.SessionState("http://127.0.0.1:19999", "ses_test_budget")

        # Patch open_url to always raise ConnectionRefusedError (subclass of OSError).
        def always_fail(url: str, timeout=None, headers=None):  # type: ignore[override]
            raise ConnectionRefusedError("refused")

        state.open_url = always_fail  # type: ignore[method-assign]

        opts = mod._StreamOpts(
            idle_heartbeat_seconds=30,
            max_reconnect_wallclock_seconds=2,
        )

        start = _time.monotonic()
        result = mod.stream_events(state, opts)
        elapsed = _time.monotonic() - start

        self.assertEqual(result, 1, "stream_events should return 1 after budget exhaustion")
        # Budget is 2s; the first backoff delay is 2s so it fires after one sleep.
        self.assertLess(elapsed, 10.0, f"stream_events took too long: {elapsed:.1f}s")


class StatusFooterEventCountTests(unittest.TestCase):
    def test_status_footer_persists_events_across_reconnect(self) -> None:
        footer = mod.StatusFooter("http://127.0.0.1:19999")

        # 3 events, then a disconnect, then 2 more events.
        footer.note_event()
        footer.note_event()
        footer.note_event()
        footer.note_disconnect("boom")
        footer.note_event()
        footer.note_event()

        rendered = footer._render()
        self.assertIn("events: 5", rendered, f"Expected 'events: 5' in footer render, got: {rendered!r}")


if __name__ == "__main__":
    unittest.main()

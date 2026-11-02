"""A timed-out template must give its browser a graceful quit before any SIGKILL.

Chrome removes its per-launch state (the macOS code-sign clone, a temp profile)
only on a clean exit, so killing the node template alone, or killing anything
without a SIGTERM grace window first, leaks it (omo#12067). A fake template and a
fake "browser" grandchild stand in for Playwright and Chrome.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine import executor  # noqa: E402

FAKE_TEMPLATE = textwrap.dedent(
    """
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const log = process.env.EXECUTOR_TEST_LOG;
    const record = (line) => fs.appendFileSync(log, `${line} ${Date.now()}\\n`);
    const browser = spawn(process.execPath, ['-e', `
      const fs = require('node:fs');
      process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, 'BROWSER_TERM ' + Date.now() + '\\\\n'); process.exit(0); });
      fs.appendFileSync(${JSON.stringify(log)}, 'BROWSER_READY ' + Date.now() + '\\\\n');
      setInterval(() => {}, 60000);
    `], { stdio: 'ignore' });
    record(`PIDS ${process.pid}:${browser.pid}`);
    process.on('SIGTERM', () => {
      record('TEMPLATE_TERM');
      if (process.env.EXECUTOR_TEST_TEMPLATE_ON_TERM === 'exit') process.exit(0);
    });
    setInterval(() => {}, 60000);
    """
)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


@unittest.skipIf(os.name == "nt" or shutil.which("node") is None, "POSIX process groups and node required")
class TimedOutTemplateTermination(unittest.TestCase):
    def _run(self, on_term: str, communicate=None) -> tuple[int, str, dict[str, list[int]], float]:
        tmp = Path(tempfile.mkdtemp(prefix="ultimate-browsing-executor-test-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "fake_template.js").write_text(FAKE_TEMPLATE, encoding="utf-8")
        log = tmp / "events.log"
        env = {"EXECUTOR_TEST_LOG": str(log), "EXECUTOR_TEST_TEMPLATE_ON_TERM": on_term}
        try:
            with mock.patch.object(executor, "TEMPLATES_DIR", str(tmp)), mock.patch.dict(os.environ, env):
                if communicate is None:
                    code, _out, err = executor._run_node_template("fake_template.js", {}, timeout=1)
                else:
                    with mock.patch.object(executor.subprocess.Popen, "communicate", communicate(log)):
                        code, _out, err = executor._run_node_template("fake_template.js", {}, timeout=30)
        finally:
            events = self._read_events(log)
        returned_at = time.time() * 1000
        return code, err, events, returned_at

    def _read_events(self, log: Path) -> dict[str, list[int]]:
        events: dict[str, list[int]] = {}
        if not log.exists():
            return events
        for line in log.read_text(encoding="utf-8").splitlines():
            name, *rest = line.split(" ")
            events.setdefault(name, []).append(int(rest[-1]))
            if name == "PIDS":
                template_pid, browser_pid = rest[0].split(":")
                events["template_pid"] = [int(template_pid)]
                events["browser_pid"] = [int(browser_pid)]
                for pid in (int(template_pid), int(browser_pid)):
                    self.addCleanup(lambda p=pid: _alive(p) and os.kill(p, 9))
        self.last_events = events
        return events

    def _assert_gone(self, pid: int) -> None:
        deadline = time.time() + 2
        while _alive(pid) and time.time() < deadline:
            time.sleep(0.05)
        self.assertFalse(_alive(pid), f"pid {pid} outlived the timed-out template")

    def test_timeout_terms_the_whole_group_and_waits_before_kill(self) -> None:
        code, err, events, returned_at = self._run(on_term="ignore")
        self.assertEqual(code, 124, err)
        self.assertIn("BROWSER_TERM", events, "the browser grandchild never got SIGTERM")
        self.assertIn("TEMPLATE_TERM", events, "the template never got SIGTERM")
        grace_ms = returned_at - events["TEMPLATE_TERM"][0]
        self.assertGreaterEqual(grace_ms, executor.TERM_GRACE_S * 1000 - 500, "SIGKILL came without a grace window")
        self._assert_gone(events["template_pid"][0])
        self._assert_gone(events["browser_pid"][0])

    def test_template_that_quits_on_term_is_not_held_for_the_grace(self) -> None:
        code, err, events, returned_at = self._run(on_term="exit")
        self.assertEqual(code, 124, err)
        self.assertIn("TEMPLATE_TERM", events)
        self.assertLess(returned_at - events["TEMPLATE_TERM"][0], 3000)
        self._assert_gone(events["browser_pid"][0])

    def test_cancelled_run_tears_the_group_down_and_reraises(self) -> None:
        # A KeyboardInterrupt (or any BaseException) during communicate() must still
        # quit node and its browser: start_new_session means a terminal Ctrl-C no
        # longer reaches the template's group, so nobody else will.
        original = subprocess.Popen.communicate

        def interrupting(log: Path):
            calls = {"n": 0}

            def communicate(proc, *args, **kwargs):
                calls["n"] += 1
                if calls["n"] > 1:
                    return original(proc, *args, **kwargs)
                deadline = time.time() + 10
                while time.time() < deadline and not (log.exists() and "BROWSER_READY" in log.read_text(encoding="utf-8")):
                    time.sleep(0.02)
                raise KeyboardInterrupt

            return communicate

        with self.assertRaises(KeyboardInterrupt):
            self._run(on_term="exit", communicate=interrupting)
        events = self.last_events
        self.assertIn("browser_pid", events, "the fake template never started")
        self.assertIn("BROWSER_TERM", events, "the browser never got SIGTERM after the run was cancelled")
        self._assert_gone(events["template_pid"][0])
        self._assert_gone(events["browser_pid"][0])


if __name__ == "__main__":
    unittest.main()

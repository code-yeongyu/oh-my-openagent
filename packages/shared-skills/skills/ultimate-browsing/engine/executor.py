"""Capability-matched executor for fallback attempts.

The fetch_chain's probe/grid phase uses curl_cffi directly. When curl can't
punch through (JS challenge, real-TLS detection), this module routes to the
right browser executor based on the profile's `capabilities_needed` tags:

    needs_real_tls_stack + needs_js_exec  → playwright_real_chrome.js
    needs_js_exec only                    → Playwright MCP (if available)
    needs_mobile_context (+ real_tls)     → playwright_mobile_chrome.js

The JS templates live in `engine/templates/` and accept only generic
parameters ({{url}}, {{waitSelector}}, {{profileDir}}, {{device}}). No
site-specific logic.

Playwright MCP invocation requires caller's tool access; this module
provides the subprocess path for local JS templates but only stubs the MCP
path (MCP must be driven from the Claude session itself).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from typing import Optional

from .validators import Verdict, validate
from .waf_detector import load_profile
from .fetch_chain import Attempt


TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


def _node_available() -> bool:
    return shutil.which("node") is not None


def _chrome_channel_available() -> bool:
    """Heuristic: try `node -e` to import playwright. Fallback to True, let script fail loudly."""
    if not _node_available():
        return False
    if shutil.which("npx") is None:
        return False
    return True


def _pick_executor(capabilities: list[str], device_class: str) -> str:
    caps = set(capabilities or [])
    if device_class == "mobile" or "needs_mobile_context" in caps:
        if "needs_real_tls_stack" in caps:
            return "playwright_mobile_chrome"
        return "playwright_mcp_mobile"
    if "needs_real_tls_stack" in caps:
        return "playwright_real_chrome"
    if "needs_js_exec" in caps:
        return "playwright_mcp"
    return "playwright_real_chrome"  # safest general fallback


def _run_node_template(template: str, args: dict, timeout: int = 90) -> tuple[int, str, str]:
    """Run a Node.js template with args as JSON on stdin.

    Template convention: reads `process.stdin` → JSON → runs fetch → writes
    HTML to stdout; errors go to stderr with non-zero exit code.
    """
    path = os.path.join(TEMPLATES_DIR, template)
    if not os.path.isfile(path):
        return 127, "", f"template not found: {path}"
    try:
        proc = subprocess.run(
            ["node", path],
            input=json.dumps(args),
            cwd=TEMPLATES_DIR,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except Exception as e:
        return 1, "", f"{type(e).__name__}:{e}"


class _FakeResp:
    """Minimal response shim so validators.validate() works on Playwright HTML."""
    def __init__(self, html: str, status: int = 200, final_url: str = ""):
        self.text = html
        self.status_code = status
        self.url = final_url
        self.cookies = _FakeCookies()
        self.headers = {}


class _FakeCookies:
    class _Jar:
        def __iter__(self):
            return iter([])
    def __init__(self):
        self.jar = self._Jar()
    def __iter__(self):
        return iter([])


def run_playwright_fallback(
    url: str,
    *,
    profile_id: str,
    success_selectors: Optional[list[str]] = None,
    device_class: str = "auto",
    timeout: int = 90,
    profile_dir: Optional[str] = None,
    force_executor: Optional[str] = None,
) -> tuple[Attempt, str]:
    """Invoke the appropriate Playwright executor.

    force_executor: caller-specified executor name (from a profile's
    `fallback_when_challenge` list). When set, it overrides capability-based
    inference. Recognized values: "playwright_real_chrome",
    "playwright_mobile_chrome", "playwright_mcp".

    Returns (Attempt, html_content). Attempt.verdict reflects validation.
    """
    profile = load_profile(profile_id)
    capabilities = profile.get("capabilities_needed") or []
    choice = force_executor or _pick_executor(capabilities, device_class)

    t0 = time.time()
    att = Attempt(
        phase="fallback",
        executor=choice,
        url=url,
        url_transform="original",
        impersonate=None,
        referer="",
    )

    if choice.startswith("playwright_mcp"):
        att.error = (
            "Playwright MCP must be invoked from the Claude session — "
            "call mcp__playwright__* tools directly instead of fetch_chain."
        )
        att.verdict = Verdict.UNKNOWN.value
        att.elapsed_s = round(time.time() - t0, 3)
        return att, ""

    if not _chrome_channel_available():
        att.error = "node/npx not available for local Playwright template"
        att.verdict = Verdict.UNKNOWN.value
        att.elapsed_s = round(time.time() - t0, 3)
        return att, ""

    template_map = {
        "playwright_real_chrome": "playwright_real_chrome.js",
        "playwright_mobile_chrome": "playwright_mobile_chrome.js",
    }
    template = template_map.get(choice)
    if template is None:
        att.error = f"no template for executor {choice}"
        att.verdict = Verdict.UNKNOWN.value
        att.elapsed_s = round(time.time() - t0, 3)
        return att, ""

    args: dict = {
        "url": url,
        "profileDir": profile_dir or os.path.join(tempfile.gettempdir(), ".insane_pw_profile"),
        "timeout": timeout * 1000,
    }
    if choice == "playwright_mobile_chrome":
        args["device"] = "iPhone 13 Pro"
    if success_selectors:
        args["waitSelector"] = success_selectors[0]

    rc, stdout, stderr = _run_node_template(template, args, timeout=timeout + 10)
    att.elapsed_s = round(time.time() - t0, 3)

    if rc != 0 or not stdout:
        att.error = (stderr or "no stdout")[:300]
        att.verdict = Verdict.UNKNOWN.value
        return att, ""

    # stdout carries HTML. Validate with a shim.
    resp = _FakeResp(stdout)
    vr = validate(resp, success_selectors=success_selectors)
    att.status = 200
    att.body_size = len(stdout)
    att.verdict = vr.verdict.value
    att.reasons = vr.reasons
    return att, stdout

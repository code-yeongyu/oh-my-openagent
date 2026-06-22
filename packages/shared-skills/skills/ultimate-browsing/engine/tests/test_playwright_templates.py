from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parents[1] / "templates"
TEMPLATE_NAMES = ("playwright_real_chrome.js", "playwright_mobile_chrome.js")
JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]


def _write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")


def _install_fake_playwright(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright" / "index.js",
        """
        const page = {
          async goto() {},
          async waitForTimeout() {},
          async waitForSelector(selector) {
            if (process.env.PW_FAKE_SELECTOR_FAIL === '1') {
              throw new Error(`missing selector ${selector}`);
            }
          },
          async reload() {},
          async content() {
            return '<html><article>ok</article></html>';
          },
        };

        const context = {
          async newPage() { return page; },
          async close() {
            if (process.env.PW_FAKE_CLOSE_FAIL === '1') {
              throw new Error('close failed');
            }
          },
        };

        exports.chromium = {
          use() {},
          async launchPersistentContext() { return context; },
        };
        exports.devices = {
          'iPhone 13 Pro': { viewport: { width: 390, height: 844 }, userAgent: 'fake-mobile' },
        };
        """,
    )


def _install_broken_playwright_extra(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        const error = new Error('stealth init failed');
        error.code = 'EACCES';
        throw error;
        """,
    )
    _write_file(
        node_modules / "puppeteer-extra-plugin-stealth" / "index.js",
        """
        module.exports = function stealth() { return {}; };
        """,
    )


def _install_working_playwright_extra(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        const playwright = require('playwright');
        exports.chromium = playwright.chromium;
        exports.devices = playwright.devices;
        """,
    )


def _install_playwright_extra_with_internal_missing_dependency(node_modules: Path) -> None:
    _write_file(
        node_modules / "playwright-extra" / "index.js",
        """
        require('transitive-stealth-runtime');
        """,
    )


def _install_self_missing_optional_module(node_modules: Path, module_name: str) -> None:
    _write_file(
        node_modules / module_name / "index.js",
        f"""
        const error = new Error("Cannot find module '{module_name}'");
        error.code = 'MODULE_NOT_FOUND';
        throw error;
        """,
    )


def _run_template(
    template_name: str,
    payload: dict[str, JsonValue],
    *,
    include_broken_extra: bool = False,
    include_working_extra: bool = False,
    include_internal_missing_extra: bool = False,
    include_self_missing_module: str | None = None,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory(prefix="ultimate-browsing-template-test-") as tmp:
        tmp_path = Path(tmp)
        node_modules = tmp_path / "node_modules"
        _install_fake_playwright(node_modules)
        if include_working_extra:
            _install_working_playwright_extra(node_modules)
        if include_broken_extra:
            _install_broken_playwright_extra(node_modules)
        if include_internal_missing_extra:
            _install_playwright_extra_with_internal_missing_dependency(node_modules)
        if include_self_missing_module:
            _install_self_missing_optional_module(node_modules, include_self_missing_module)

        script_path = tmp_path / template_name
        script_path.write_text((TEMPLATES_DIR / template_name).read_text(encoding="utf-8"), encoding="utf-8")

        env = os.environ.copy()
        env.pop("NODE_PATH", None)
        if env_overrides:
            env.update(env_overrides)

        return subprocess.run(
            ["node", str(script_path)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=5,
            env=env,
            check=False,
        )


@unittest.skipUnless(shutil.which("node"), "node is required for Playwright template tests")
class PlaywrightTemplateErrorHandling(unittest.TestCase):
    def test_missing_playwright_extra_warns_and_falls_back_to_plain_playwright(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                    },
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", result.stdout)
                self.assertIn("best-effort optional module playwright-extra failed:", result.stderr)
                self.assertIn("Cannot find module 'playwright-extra'", result.stderr)

    def test_missing_stealth_plugin_warns_and_falls_back_to_plain_playwright(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                    },
                    include_working_extra=True,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", result.stdout)
                self.assertIn("best-effort optional module puppeteer-extra-plugin-stealth failed:", result.stderr)
                self.assertIn("Cannot find module 'puppeteer-extra-plugin-stealth'", result.stderr)

    def test_non_missing_stealth_dependency_error_is_not_swallowed(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                    },
                    include_broken_extra=True,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("stealth init failed", result.stderr)
                self.assertNotIn("best-effort optional module", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_internal_module_resolution_error_is_not_treated_as_optional_missing_dependency(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                    },
                    include_internal_missing_extra=True,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Cannot find module 'transitive-stealth-runtime'", result.stderr)
                self.assertNotIn("best-effort optional module", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_present_optional_module_self_missing_error_is_not_swallowed(self) -> None:
        cases = (("playwright-extra", False), ("puppeteer-extra-plugin-stealth", True))
        for template_name in TEMPLATE_NAMES:
            for module_name, include_working_extra in cases:
                with self.subTest(template_name=template_name, module_name=module_name):
                    result = _run_template(
                        template_name,
                        {
                            "url": "https://example.com/article",
                            "profileDir": "/tmp/ultimate-browsing-test-profile",
                            "headless": True,
                        },
                        include_working_extra=include_working_extra,
                        include_self_missing_module=module_name,
                    )

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(f"Cannot find module '{module_name}'", result.stderr)
                    self.assertNotIn("best-effort optional module", result.stderr)
                    self.assertEqual(result.stdout, "")

    def test_selector_failures_are_reported_as_best_effort_warnings(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                        "waitSelector": "article.ready",
                    },
                    env_overrides={"PW_FAKE_SELECTOR_FAIL": "1"},
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", result.stdout)
                self.assertIn("best-effort waitSelector failed:", result.stderr)
                self.assertNotIn("waitSelector article.ready", result.stderr)

    def test_context_close_failures_are_reported_after_successful_html_output(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name):
                result = _run_template(
                    template_name,
                    {
                        "url": "https://example.com/article",
                        "profileDir": "/tmp/ultimate-browsing-test-profile",
                        "headless": True,
                    },
                    env_overrides={"PW_FAKE_CLOSE_FAIL": "1"},
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("<article>ok</article>", result.stdout)
                self.assertIn("best-effort browser context close failed:", result.stderr)


if __name__ == "__main__":
    unittest.main()

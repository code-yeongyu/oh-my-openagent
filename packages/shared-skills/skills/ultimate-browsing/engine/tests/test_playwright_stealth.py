from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_playwright_templates import (
    TEMPLATE_NAMES,
    TEMPLATES_DIR,
    _install_fake_playwright,
    _write_file,
)


class PlaywrightTemplateStealth(unittest.TestCase):
    def test_extracts_html_and_closes_wrapped_chrome_when_stealth_is_installed(self) -> None:
        for template_name in TEMPLATE_NAMES:
            with self.subTest(template_name=template_name), tempfile.TemporaryDirectory() as tmp:
                # Given: core has no plugin API; only addExtra supplies a registered wrapper.
                root = Path(tmp)
                modules = root / "node_modules"
                profile = root / "profile"
                receipt = root / "launch.json"
                _install_fake_playwright(modules)
                _write_file(modules / "puppeteer-extra-plugin-stealth/index.js", """
                    module.exports = () => ({ name: 'stealth' });
                """)
                _write_file(modules / "playwright-extra/index.js", """
                    const assert = require('node:assert/strict');
                    const fs = require('node:fs');
                    exports.addExtra = (core) => {
                      assert.equal(core, require('playwright-core').chromium);
                      assert.equal(Object.hasOwn(core, 'use'), false);
                      const events = ['wrap'];
                      let registered = false;
                      return {
                        use(plugin) {
                          assert.equal(plugin.name, 'stealth');
                          registered = true;
                          events.push(plugin.name);
                        },
                        async launchPersistentContext(profileDir, options) {
                          assert.equal(registered, true);
                          events.push({ profileDir, channel: options.channel, viewport: options.viewport });
                          const context = await core.launchPersistentContext(profileDir, options);
                          return {
                            ...context,
                            async close() {
                              await context.close();
                              events.push('close');
                              fs.writeFileSync(process.env.STEALTH_RECEIPT, JSON.stringify(events));
                            },
                          };
                        },
                      };
                    };
                """)
                script = root / template_name
                script.write_bytes((TEMPLATES_DIR / template_name).read_bytes())
                env = {key: value for key, value in os.environ.items() if key != "NODE_PATH"}
                env["STEALTH_RECEIPT"] = str(receipt)

                # When: the actual bundled entry point consumes its normal stdin protocol.
                result = subprocess.run(
                    ["node", str(script)],
                    input=json.dumps({"url": "https://example.com/", "profileDir": str(profile), "headless": True}),
                    text=True, capture_output=True, timeout=5, env=env, check=False,
                )

                # Then: HTML arrives through the registered wrapper and the context is closed.
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "<html><article>ok</article></html>")
                self.assertEqual(result.stderr, "")
                viewport = {"width": 390, "height": 844} if "mobile" in template_name else {"width": 1366, "height": 900}
                self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), [
                    "wrap", "stealth",
                    {"profileDir": str(profile), "channel": "chrome", "viewport": viewport},
                    "close",
                ])


if __name__ == "__main__":
    unittest.main()

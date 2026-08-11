# ATTRIBUTION / NOTICE

This skill (`ultimate-browsing`, part of `@oh-my-opencode/shared-skills`) ships
project-original content plus two third-party tools that it installs at runtime
(it does NOT vendor their source). Each runtime tool's license and required
notices are reproduced below.

---

## 1. Project-original content (no third-party source vendored)

The following are authored by the oh-my-openagent project and carry no third-party
license obligation:

- `engine/**` — the insane-search Tier-1 fetch engine (curl_cffi grid, WAF
  detection, Playwright fallback templates, `bias_check.py` no-site-name gate).
- `references/insane-search/**` and `references/agent-reach/**` — the Tier-1 and
  Tier-1.5 reference docs.
- `scripts/extract_cookies.py`, `scripts/cookie_paths.py`, `scripts/cookie_crypto.py`
  and their tests — the cross-platform cookie module.
- `SKILL.md`, `references/chrome-stealth.md`.

These reference platform-native CLIs and public APIs by name (e.g. `xhs`, `yt-dlp`,
`agent-reach`, `mcporter`, Jina Reader, V2EX public API). Those are external tools the
user installs separately; this skill includes none of their source.

---

## 2. CloakBrowser (CloakHQ) — Tier-2 stealth Chromium (runtime dependency)

The Tier-2 stealth browser is **CloakBrowser**, installed at runtime via `pip`
(`pip install cloakbrowser`). No CloakBrowser source is vendored in this repository.

- Source: https://github.com/CloakHQ/CloakBrowser
- Pinned runtime version: **0.4.10** (documented in `references/chrome-stealth.md`;
  this is a documented version string, not an automated drift check).
- Wrapper source license: MIT License.
- Binary license: the compiled CloakBrowser Chromium binary downloaded by
  `cloakbrowser.ensure_binary()` is governed by the separate CloakBrowser
  Binary License:
  https://github.com/CloakHQ/CloakBrowser/blob/main/BINARY-LICENSE.md
- Redistribution note: this npm package does not redistribute the CloakBrowser
  binary, does not repackage it, and does not include it in `skills/` or
  `dist/skills`. Users who run the Tier-2 setup download the binary directly
  from CloakHQ's official distribution channels and must comply with that
  binary license.

MIT wrapper source license:

```
MIT License

Copyright (c) 2026 CloakHQ

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. agent-browser (vercel-labs) — Tier-2 CDP automation CLI (runtime dependency)

The Tier-2 automation CLI is **agent-browser**, installed at runtime via `npm`
(`npm i -g agent-browser`). No agent-browser source is vendored in this repository.

- Source: https://github.com/vercel-labs/agent-browser
- Pinned runtime version: **0.31.1** (documented in `references/chrome-stealth.md`;
  documented version string, no automated drift check).
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  these files except in compliance with the License. You may obtain a copy of the
  License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License.

- **Changes (Apache-2.0 §4(b)):** none. agent-browser is installed unmodified at
  runtime; no agent-browser source file is copied, modified, or redistributed by this
  skill. This skill only documents how to invoke the upstream CLI.

- **NOTICE:** the upstream agent-browser distribution may include a `NOTICE` file. As
  this skill redistributes no agent-browser source, no upstream NOTICE content is
  bundled here; consult the upstream repository for its `NOTICE` file when present.

- **Trademark notice:** "agent-browser" and "Vercel" are referenced by name for
  identification only. No trademark license is granted under the Apache License 2.0
  (Section 6).

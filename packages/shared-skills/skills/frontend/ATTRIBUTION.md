# ATTRIBUTION / NOTICE

This package (`@oh-my-opencode/shared-skills`) includes third-party content that is
redistributed under its original license, consistent with the project's distribution
license (see `LICENSE.md`: "All third party components incorporated into the
oh-my-opencode Software are licensed under the original license provided by the owner of
the applicable component"). Each upstream's license and required notices are reproduced
below. Modifications to the original files are noted where applicable.

These third-party references are NOT committed to this repository. Each upstream is
tracked as a pinned git submodule under `packages/shared-skills/upstreams/<name>`, and the
build materializes the referenced files verbatim, path-mapped into this skill's
`references/` tree, when packaging the published artifact. The `Pinned upstream commit`
line in each section below records the exact submodule commit that the materialization
reads.

---

## 1. Open Design (brand design-system DESIGN.md references)

The brand design-system reference files under `frontend/references/design/<brand>.md`
(Apple, Stripe, Linear, Nike, BMW, Airbnb, Bugatti, Tesla, and the other named brands)
are path-mapped verbatim copies of the `design-systems/<brand>/DESIGN.md` files from the
Open Design project. They are not committed here; the build materializes them from the
pinned submodule under `packages/shared-skills/upstreams/open-design` into
`frontend/references/design/<brand>.md` (dots in `<brand>` map to dashes for the upstream
directory name, e.g. `linear.app` -> `linear-app`).

- Source: https://github.com/nexu-io/open-design
- Pinned upstream commit: 6afe7eae156bfa29251a51fd0636649c257f7444
- Copyright 2026 Open Design contributors
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use these
  files except in compliance with the License. You may obtain a copy of the License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License. A full copy of the Apache-2.0 license
  text is provided in `LICENSE-Apache-2.0.txt` alongside this notice.

- **Changes (Apache-2.0 §4(b)):** the original `DESIGN.md` design-system files are
  redistributed verbatim. The only modification is path-mapping: each upstream
  `design-systems/<brand>/DESIGN.md` is renamed to `frontend/references/design/<brand>.md`
  (with dots in the brand name mapped to dashes for the upstream directory lookup). The
  file contents are byte-for-byte identical to the pinned upstream commit; no text is
  abridged, summarized, or rewritten.

- **Trademark notice:** All product names, brand names, trademarks, and registered
  trademarks referenced in these design-system files (e.g. Apple, BMW, Airbnb, Bugatti,
  Stripe, Nike, Tesla, and other named brands) are the property of their respective owners
  and are used for identification and descriptive purposes only. This project is not
  affiliated with, endorsed by, or sponsored by any of those brands. No trademark license
  is granted under the Apache License 2.0 (Section 6). Named typefaces are referenced by
  name only; no font binaries are included.

---

## 2. taste-skill (Leonxlnx) — taste and image-generation skills

The taste-skill files and image-generation skills under `frontend/references/design/`
(`taste-skill.md`, `gpt-tasteskill.md`, `minimalist-skill.md`, `brutalist-skill.md`,
`soft-skill.md`, `redesign-skill.md`, `image-to-code-skill.md`, `output-skill.md`,
`stitch-skill.md`, `imagegen-frontend-web.md`, `imagegen-frontend-mobile.md`,
`imagegen-brandkit.md`) are path-mapped verbatim copies of the per-skill `SKILL.md` files
from the taste-skill project (each `skills/<name>/SKILL.md` is renamed to
`references/design/<name>.md`; `imagegen-brandkit.md` maps from `skills/brandkit/SKILL.md`).
They are not committed here; the build materializes them from the pinned submodule under
`packages/shared-skills/upstreams/taste-skill`.

- Source: https://github.com/Leonxlnx/taste-skill
- Pinned upstream commit: 06d6028b5c623016c59ce8536f578e5a1127b499

```
MIT License

Copyright (c) 2026 Leonxlnx

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

## 3. UI/UX Pro Max — Design Intelligence Skill (Next Level Builder) — ui-ux-db

The search engine and dataset under `frontend/references/ui-ux-db/` (`scripts/core.py`,
`scripts/search.py`, `scripts/design_system.py`, `README.md`, and the `data/*.csv`
knowledge base) are path-mapped verbatim copies from the UI/UX Pro Max skill. They are not
committed here; the build materializes them from the pinned submodule under
`packages/shared-skills/upstreams/ui-ux-pro-max`:
`scripts/*.py` from `src/ui-ux-pro-max/scripts/`, `data/*.csv` from
`src/ui-ux-pro-max/data/` (`data/web-interface.csv` maps from the upstream
`data/app-interface.csv`), and `README.md` from `.claude/skills/ui-ux-pro-max/SKILL.md`.

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Pinned upstream commit: f32d6a61cdf0bfd57404c45854583fd19ff95088
- "UI/UX Pro Max" is the upstream project's branding; no trademark rights are granted by
  the MIT license, and this distribution does not claim that name as its own.

```
MIT License

Copyright (c) 2024 Next Level Builder

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

## 4. designpowers (Owl-Listener) — design operating-layer references

The designpowers reference corpus under `frontend/references/designpowers/vendor/` is
path-mapped verbatim from the designpowers project. It is not committed here; the build
materializes the selected files from the pinned submodule under
`packages/shared-skills/upstreams/designpowers`. The materialized set includes the
upstream `LICENSE`, ten `agents/*.md` role-reference files, and selected
`skills/*/SKILL.md` files. Bridge/state/router integration skills are intentionally
excluded; see `frontend/references/designpowers/UPSTREAM.md` for the allowlist and
exclusion list.

- Source: https://github.com/Owl-Listener/designpowers
- Pinned upstream commit: cb00757da9d554591fa78d27aa1854d60a05c4f7

```
MIT License

Copyright (c) 2026 MC Dean

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

## 5. Project-original files

`frontend/SKILL.md`, `frontend/references/design/README.md`, `_INDEX.md`,
`design-system-architecture.md`, `react-dev-tooling-skill.md`,
`frontend/references/perfection/README.md`, `react-perf-tooling.md`, and
`frontend/scripts/perfection/lighthouse-audit.py` are original to this project and require
no third-party attribution. The perfection docs and script only invoke third-party tools
(react-scan, react-doctor, react-grab, playwright-lighthouse, lighthouse, chrome-launcher)
at runtime; no source from those tools is vendored, so their licenses are not carried here.

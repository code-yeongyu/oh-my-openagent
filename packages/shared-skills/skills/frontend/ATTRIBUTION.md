# ATTRIBUTION / NOTICE

This package (`@oh-my-opencode/shared-skills`) includes third-party content that is
redistributed under its original license, consistent with the project's distribution
license (see `LICENSE.md`: "All third party components incorporated into the
oh-my-opencode Software are licensed under the original license provided by the owner of
the applicable component"). Each upstream's license and required notices are reproduced
below. Modifications to the original files are noted where applicable.

---

## 1. Open Design (brand design-system DESIGN.md references)

The brand design-system reference files under `frontend/references/design/<brand>.md`
(Apple, Stripe, Linear, Nike, BMW, Airbnb, Bugatti, Tesla, and the other named brands)
are condensed/adapted derivatives of the `design-systems/<brand>/DESIGN.md` files from the
Open Design project.

- Source: https://github.com/nexu-io/open-design
- Copyright 2026 Open Design contributors
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use these
  files except in compliance with the License. You may obtain a copy of the License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License. A full copy of the Apache-2.0 license
  text is provided in `LICENSE-Apache-2.0.txt` alongside this notice.

- **Changes (Apache-2.0 §4(b)):** the original `DESIGN.md` design-system files have been
  condensed/adapted from the Open Design project for use as frontend skill references.
  Specifically, the leading "> Category: ..." blockquote was removed and the documents were
  shortened into derivative single-file brand references.

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
`imagegen-brandkit.md`) are derived from the taste-skill project.

- Source: https://github.com/Leonxlnx/taste-skill

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
knowledge base) are derived from the UI/UX Pro Max skill.

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
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

## 4. Project-original files

`frontend/SKILL.md`, `frontend/references/design/README.md`, `_INDEX.md`,
`design-system-architecture.md`, `react-dev-tooling-skill.md`,
`frontend/references/perfection/README.md`, `react-perf-tooling.md`, and
`frontend/scripts/perfection/lighthouse-audit.py` are original to this project and require
no third-party attribution. The perfection docs and script only invoke third-party tools
(react-scan, react-doctor, react-grab, playwright-lighthouse, lighthouse, chrome-launcher)
at runtime; no source from those tools is vendored, so their licenses are not carried here.

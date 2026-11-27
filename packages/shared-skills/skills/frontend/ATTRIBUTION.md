# ATTRIBUTION / NOTICE

This package (`@oh-my-opencode/shared-skills`) includes third-party content that is
redistributed under its original license, consistent with the project's distribution
license (see `LICENSE.md`: "All third party components incorporated into the
oh-my-opencode Software are licensed under the original license provided by the owner of
the applicable component"). Each upstream's license and required notices are reproduced
below. Modifications to the original files are noted where applicable.

These third-party references are NOT committed to this repository. Each upstream is
tracked as a pinned git submodule under `packages/shared-skills/upstreams/<name>`, and the
build materializes the referenced files path-mapped into this skill's `references/` tree,
when packaging the published artifact. The file bodies are copied verbatim, except
materialized `SKILL.md` frontmatter may normalize an unquoted single-line `description:`
scalar into a JSON-quoted YAML string so Codex/OpenCode frontmatter parsing remains
deterministic; the description text itself is unchanged. The `Pinned upstream commit` line
in each section below records the exact submodule commit that the materialization reads.

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
`imagegen-brandkit.md`) are path-mapped copies of the per-skill `SKILL.md` files from the
taste-skill project (each `skills/<name>/SKILL.md` is renamed to
`references/design/<name>.md`; `imagegen-brandkit.md` maps from `skills/brandkit/SKILL.md`).
`stitch-design-example.md` is a path-mapped verbatim copy of `skills/stitch-skill/DESIGN.md`,
the worked example of the design-system document that the stitch skill exports.
They are not committed here; the build materializes them from the pinned submodule under
`packages/shared-skills/upstreams/taste-skill`. Only the allowed frontmatter description
quoting normalization described above may alter these materialized `SKILL.md` files.

- Source: https://github.com/Leonxlnx/taste-skill
- Official site: https://www.tasteskill.dev/
- Pinned upstream commit: b17742737e796305d829b3ad39eda3add0d79060

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
path-mapped from the designpowers project. It is not committed here; the build
materializes the selected files from the pinned submodule under
`packages/shared-skills/upstreams/designpowers`. The materialized set includes the
upstream `LICENSE`, ten `agents/*.md` role-reference files, and selected
`skills/*/SKILL.md` files renamed to `vendor/skills/*/reference.md` so they remain
reference documents instead of nested skill entrypoints. Bridge/state/router integration skills are intentionally
excluded; see `frontend/references/designpowers/UPSTREAM.md` for the allowlist and
exclusion list. Only the allowed frontmatter description quoting normalization described
above may alter these materialized `reference.md` files.

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

`frontend/SKILL.md` (apart from the browser-surface, type-and-spacing-floor, and generated-scaffold
rules adapted from Impeccable, section 6), `frontend/references/design/README.md`, `_INDEX.md`, `aside.md`,
`design-system-architecture.md`, `grounding.md`, `react-dev-tooling-skill.md`,
`frontend/references/perfection/README.md`, `react-perf-tooling.md`, and
`frontend/scripts/perfection/lighthouse-audit.py` are original to this project and require
no third-party attribution. The perfection docs and script only invoke third-party tools
(react-scan, react-doctor, react-grab, playwright-lighthouse, lighthouse, chrome-launcher)
at runtime; no source from those tools is vendored, so their licenses are not carried here.

`frontend/references/design/aside.md` is a project-original synthesis from live browser
capture evidence and a local reconnaissance run following the MIT-licensed
`JCodesMore/ai-website-cloner-template` workflow; it is not copied from Aside or from the
template. Aside names, trademarks, product text, and visual assets remain the property of
their respective owners and are referenced only for descriptive design-analysis purposes.

`frontend/references/design/lazyweb.md` is a project-original, curl-only operating guide
for the Lazyweb (lazyweb.com) design-research API, written from live endpoint verification;
no Lazyweb source, documentation text, or screenshot content is vendored. Lazyweb names
remain the property of their owner, and the guide grants no license to ship, trace, or
commit reference screenshots harvested through it.

`frontend/references/design/interaction-skill.md` is a project-original, curl-only
operating guide for consulting the beui.dev animated-component registry during interaction
and motion work, written from live endpoint verification; no beui.dev source code,
documentation text, or component implementations are vendored. beui.dev names remain the
property of their owner, and the guide instructs reading component source for mechanism
extraction only, not copying it into references or projects.

`frontend/references/design/ambience-skill.md` is a project-original, curl-only operating
guide for consulting the react-bits (reactbits.dev) animated-component registry during hero
atmosphere, background, typographic-motion, and card-surface work, written from live endpoint
verification; no react-bits source code, documentation text, or component implementations are
vendored. react-bits is distributed under MIT plus the Commons Clause, which permits use inside
applications but forbids redistributing or porting the components themselves; the guide
therefore instructs reading component source for mechanism extraction only and never copying
it into references, design documents, or this repository. React Bits names remain the property
of their owner.

`frontend/references/design/component-catalogs.md` is a project-original, curl-only operating
guide that routes by tone and situation to public component catalogs (smoothui, cult-ui,
kokonutui, magicui, bklit, vengenceui, neobrutalism, daisyUI, shadcn/ui, animate-ui, Aceternity
UI, unlumen UI) and to the MUI X Charts styling docs, written from live endpoint, licence,
terms-of-service, and robots.txt verification on 2026-10-06; no catalog source code,
documentation text, or component implementations are vendored. It records each catalog's
licence class: animate-ui is MIT plus the Commons Clause, and Aceternity UI and unlumen UI
permit use in applications but forbid redistributing the components themselves, so the guide
instructs reading source for mechanism extraction only. It excludes styles.refero.design (its
robots.txt disallows AI agents), skiper-ui.com (its terms forbid copying site material), and
originkit.dev (partnership licence). All catalog names remain the property of their owners.

`frontend/references/design/clone-from-url.md` is a project-original runtime-extraction
workflow guide. Its browser + `getComputedStyle` clone approach follows the same
MIT-licensed `JCodesMore/ai-website-cloner-template` clone-website workflow that `aside.md`
cites; no source from that template is copied. It carries no third-party attribution beyond
that lineage note, and it grants no license to copy any target site's trademarks, brand
assets, or proprietary copy.

---

## 6. Impeccable (Paul Bakaus): craft-floor rules

`frontend/references/perfection/craft-floor.md`, the "Browser surfaces", "Type and spacing
floor" and "No generated scaffold" rules in `frontend/SKILL.md`, and the matching
`visual-qa/SKILL.md` checklist items (A3 measure, A13, B8, E7, F8, F9) are adapted from
`skill/reference/craft-floor.md` of the Impeccable project. Unlike sections 1-4 these files
are committed: they are rewritten in this project's words, with a few short phrases kept
close to the source.

- Source: https://github.com/pbakaus/impeccable
- Adapted from upstream commit: 5e745ace7e151feb2a93d360d0281fe39448b857
- Copyright 2025 Paul Bakaus
- Licensed under the Apache License, Version 2.0 (the "License"); you may not use these
  files except in compliance with the License. You may obtain a copy of the License at:

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed under
  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied. See the License for the specific language governing
  permissions and limitations under the License. A full copy of the Apache-2.0 license
  text is provided in `LICENSE-Apache-2.0.txt` alongside this notice.

- **Changes (Apache-2.0 §4(b)):** the rules were selected and rewritten. Kept: the
  browser-surface list, more space above a heading than below it, the 65-75ch body
  measure, the 6rem display cap, the -0.04em tracking floor, and the scaffold and shadow
  patterns listed above. Added: a property per browser surface, the 1.25x type-scale step,
  the 1.5x above-versus-below heading ratio, the 2x between-versus-within group gap, the
  phone measure floor, the split into floors and route-overridable defaults (the kicker is a
  default here, not upstream's absolute ban), and the `/visual-qa` item mapping. Dropped
  because they conflict with this skill: blur and `backdrop-filter` as general motion
  materials (here they animate only in an ambience reveal the brief asked for), choosing
  one theme per product category, decorative custom scrollbars, a blanket bounce-easing
  ban, and the common-typeface ban.
  The upstream `NOTICE.md` names only the MIT-licensed `platform-design-skills` origin of
  its iOS and Android references, none of which is used here.

---

## 7. frontend-detect SDK: Impeccable detector logic and a StyleGallery reflow check

`frontend/scripts/detect/` (the SDK, its rules under `rules/`, the CLI, and their tests),
`frontend/references/perfection/detect.md`, and the development parity scripts
`packages/shared-skills/scripts/detect-parity.ts`, `detect-source-parity.ts` and `detect-parity-oracle.ts` reimplement in TypeScript the rule logic of
the Impeccable detector (`crates/core`, `crates/detect`, `crates/foundation/src/registry.rs`)
at the upstream commit named in section 6. No Rust or JavaScript source is copied; the rule
ids, thresholds, exemptions and the `data-impeccable-ignore` waiver attribute follow
upstream so findings stay comparable, and the unit tests model upstream's fixture cases.
The license, copyright line and license text pointer in section 6 apply to this derived
work as well. `detect-parity-oracle.ts` is not shipped in the skill: at development time it
loads the prebuilt in-page detector from a local Impeccable checkout to record reference
findings, and copies none of it.

- **Changes (Apache-2.0 §4(b)):** a new TypeScript implementation over a browser-captured
  page snapshot instead of upstream's Rust engine and WASM bundle; every rule description
  and fix hint is rewritten; `low-contrast` is an error rather than a warning; project
  allowlists (`allowFonts`, `allowEasings`) and design tokens are configuration rather than
  files; our own `data-detect-ignore` waiver is added beside upstream's; telemetry, the
  hosted design-direction service, the edit hook, the live mode and the browser extension
  are not ported.

The `viewport-reflow` rule and the reflow pass in `detect.ts` (render at 320, 375, 768,
1024 and 1440 px, append an unbroken stress string at 320 px, report horizontal overflow)
follow the layout verification matrix and `tests/pattern-runtime.spec.mjs` of StyleGallery.

- Source: https://github.com/changeroa/StyleGallery
- Adapted from upstream commit: 0bf928f6269b1cb6cf24f04e0bf28a8ce2bbc0ff
- Code licensed under the MIT License; documentation under CC BY 4.0:

```
MIT License

Copyright (c) 2026 IYEN

This license applies to the source code in this repository: scripts, CLI and
MCP server implementations, the website and server code under `site/`,
validators, and test code. The Markdown documentation, pattern and recipe
prose, and domain documents are licensed separately under CC BY 4.0; see
LICENSE-DOCS. Third-party material adapted into this repository keeps its
original rights; see NOTICE.

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

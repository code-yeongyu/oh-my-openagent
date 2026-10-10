# ATTRIBUTION / NOTICE

This skill (`ultimate-browsing`, part of `@oh-my-opencode/shared-skills`) ships
project-original content and one vendored-and-modified upstream engine.
Each component's provenance, license, and required notices are reproduced below.

---

## 1. insane-search engine — vendored upstream snapshot, modified

`engine/**` originates from the **insane-search** project and is NOT
project-original code, despite being heavily modified since import.

- Upstream source: https://github.com/fivetaku/insane-search
- Vendored into this repository on 2026-06-21 by commit
  **`a4e4ed797`** (`feat(ultimate-browsing): vendor insane-search engine (junk-excluded)`),
  via an explicit file whitelist that excluded caches and smoke-test junk.
- Baseline: the upstream state as of that date, a **pre-0.7.0 snapshot**.
  Upstream's CHANGELOG dates 0.7.0 to 2026-06-22; imported files carry no
  version marker. We have never re-vendored since; the tree has diverged in
  both directions.
- Modifications by this project (non-exhaustive): de-personalization
  (`4743199a5`), the Phase 2.5 surrogate retrieval stage and surrogate registry,
  the provenance/trust result contract, the `bias_check.py` no-site-name CI gate,
  module split of the fetch chain, and the Python test suite under
  `engine/tests/`.
- No upstream `LICENSE` file was included in the vendored snapshot, so this
  repository has no upstream license text to reproduce here. Do not infer
  project-original licensing from that absence; treat `engine/**` as
  upstream-derived when reasoning about provenance.

The binding version policy — which upstream baseline we sit on, why we stay
pinned, what a future re-vendor must preserve, and what it must not import — is
[`engine/AGENTS.md` §UPSTREAM BASELINE AND VERSION POLICY](engine/AGENTS.md).

---

## 2. Project-original content (no third-party source vendored)

The following are authored by the oh-my-openagent project and carry no third-party
license obligation:

- `references/insane-search/**` and `references/agent-reach/**` — the Tier-1 and
  Tier-1.5 reference docs.
- `scripts/extract_cookies.py`, `scripts/cookie_paths.py`, `scripts/cookie_crypto.py`
  and their tests — the cross-platform cookie module.
- `SKILL.md`, `references/chrome-stealth.md`.

These reference platform-native CLIs and public APIs by name (e.g. `xhs`, `yt-dlp`,
`agent-reach`, `mcporter`, Jina Reader, V2EX public API). Those are external tools the
user installs separately; this skill includes none of their source.

# ultimate-browsing/engine — Generic WAF-Profile Fetch Chain (Python)

**Generated:** 2026-08-10 / 38d268995

## UPSTREAM BASELINE AND VERSION POLICY

**READ THIS BEFORE TOUCHING `engine/**` OR PROPOSING AN UPSTREAM SYNC.**

This engine is NOT project-original code. It is a vendored-and-modified snapshot of
[fivetaku/insane-search](https://github.com/fivetaku/insane-search), and the version
we run on is a deliberate choice, not an accident of neglect.

### The pin

| Fact | Value |
|---|---|
| Upstream project | `https://github.com/fivetaku/insane-search` |
| Vendoring commit | `a4e4ed797` (2026-06-21) `feat(ultimate-browsing): vendor insane-search engine (junk-excluded)` |
| De-personalization | `4743199a5` (2026-06-21) |
| Pinned upstream baseline | upstream state as of 2026-06-21, **pre-0.7.0** (0.7.0 is dated 2026-06-22) |
| Re-vendors since | none — every later change here is ours |

We intentionally track a **pinned baseline plus local divergence**, not upstream HEAD.
There is no submodule and no automated drift check for this engine (unlike the
`frontend` skill's upstream submodules): the vendored files ARE the source of truth,
and upstream is a reference we port FROM, deliberately, file by file.

### Why we do not blind-rebase onto upstream HEAD

1. **Upstream reset its public history.** On 2026-08-06 upstream published a single
   squashed commit, `019ee16 refactor: reset public history at 0.14.0`, discarding the
   prior public history through 0.13.x. There is no upstream commit graph to rebase onto and no
   way to cherry-pick an individual upstream change by sha — only whole-file diffing
   against a moving HEAD.
2. **Upstream 0.14.0 REMOVED capability.** The endpoint-mining / internal-API
   auto-derivation / site-recipe subsystems that upstream carried publicly between
   0.12.0 and 0.14.0 are gone from upstream HEAD. Syncing to HEAD is therefore not
   strictly an upgrade: parts of it are a downgrade relative to the intermediate
   versions, and none of it is recoverable from the reset history.
3. **Our tree diverged on purpose.** The KEEP list below is functionality upstream
   never had. A wholesale overwrite with upstream HEAD would silently delete it.
4. **Different threat model.** Our engine ships inside a published npm package and a
   public marketplace mirror, under a CI no-site-name gate and a de-personalization
   deny-list. Upstream carries neither constraint, so upstream code is not
   drop-in-shippable here.

### KEEP — our divergences a re-vendor MUST NOT regress

These exist only in our tree. Any upstream sync that removes or bypasses one of them
is a regression, not an upgrade:

- **Phase 2.5 surrogate retrieval** (`surrogate.py`, `surrogates.yaml`) — archive /
  reader / proxy routes tried before paying for a browser spin-up, with per-entry
  `last_verified` staleness handling and `--allow-proxy` gating.
- **Provenance / trust contract** (`result_schema.py`) — `Provenance` and `Trust`
  literals on every result, so a snapshot can never be reported as the live page.
- **Surrogate dead-end validation** (L1.5 in `validators.py`) — interstitial titles and
  AMP-style redirect stubs rejected instead of returned as content.
- **The no-site-name rule and its CI gate** (`bias_check.py`) — zero hard-coded site
  names, brands, or target domains in `engine/**`.
- **Module split of the fetch chain** — `curl_probe` / `referers` / `url_transforms` /
  `waf_detector` / `validators` / `executor` / `summary` as separate modules rather than
  one monolith.
- **The Python test suite** under `engine/tests/` with its HTML/JSON fixtures.
- **De-personalization** — no personal absolute paths, no personal auth token literals,
  no personal browser choice; enforced by `depersonalization-gate.test.ts`.
- **Skill-level layering** — the engine is Tier 1 under a router that also owns Tier 1.5
  (agent-reach) and Tier 2 (CloakBrowser + agent-browser). Upstream has no such tiering.

### WANT — upstream improvements worth porting forward

Our snapshot predates these; they are wanted, and each must be ported as a reviewed,
site-agnostic change that preserves every KEEP item above. Port individually; never as
a tree overwrite:

- **Content quality**: dedicated markdown conversion of fetched HTML, main-content
  extraction, PDF text extraction, and JSON-LD rescue when the HTML body is thin.
- **Transient-failure retry** and **render-merge** of statically fetched HTML with the
  browser-rendered DOM.
- **Differential block classification** — distinguishing a bot-detection block from an
  infrastructure or authentication failure, instead of collapsing both into `challenge`.
- **Additional stealth fetch backends** beyond the current Playwright templates, and
  additional WAF vendor profiles.
- **Per-host route learning** — remembering which route succeeded for a host, with a TTL
  and a bounded store. Must stay runtime state, never committed site knowledge (R4).
- **Engine-level Phase 0 routing** — the official-public-API preference is currently only
  a documented rule (R5) the agent can skip; upstream moved it into code so it cannot be
  skipped. Worth adopting.

### OUT OF SCOPE

- **The removed upstream endpoint-mining / internal-API auto-derivation / site-recipe
  subsystems.** They are absent from upstream HEAD and are not reconstructed here. They
  also sit against R3/R4 and R7's anti-bias rule: discovered internal endpoints are
  runtime findings, never committed engine knowledge.
- **Any upstream code carrying site-specific selectors, domains, or brand names.** It
  fails `bias_check.py` at the door; re-derive it site-agnostically or leave it out.
- **Automated upstream tracking.** No submodule, no drift check, no auto-bump. Syncing is
  a deliberate, reviewed, human-initiated act.

### THE SYNC RULE

Any future upstream sync preserves BOTH sides. Concretely:

1. Diff the specific upstream capability you want against our tree — do not overwrite
   files wholesale, and never `git checkout` upstream over `engine/`.
2. Port it as its own reviewed change, keeping every KEEP item intact.
3. Re-run `python3 engine/bias_check.py` and the `engine/tests/` suite; a port that
   introduces a site name or breaks a fixture does not ship.
4. Update the pin table above (baseline, date, what was ported) in the same change, plus
   the provenance section of [`../ATTRIBUTION.md`](../ATTRIBUTION.md).
5. If a port must drop a KEEP item, say so explicitly in the PR and get it agreed first —
   silent regressions of the KEEP list are the failure mode this policy exists to prevent.

## OVERVIEW

A 17-module Python package embedded in the `ultimate-browsing` skill: a site-agnostic fetch chain that escalates from a cheap curl probe to a real browser, with declarative WAF and surrogate registries. Not "optional scripts" — it has its own CLI entry (`python3 -m engine URL`), two YAML config schemas, a 4-file test suite, and a standalone CI guard. Package exports (`__init__.py`): `fetch`, `FetchResult`, `Attempt`, `Verdict`, `ValidationResult`, `validate`, `CHALLENGE_MARKERS`, `detect`, `TRANSFORMS`, `apply_transform`.

## THE NO-SITE-NAME RULE (enforced in CI)

`engine/**` must contain **zero** hard-coded site names, brands, or target domains. Site specifics belong to runtime hints or observations, never to code. `bias_check.py` is a standalone scanner enforcing this: a brand denylist, a URL regex scan, an allowlist for genuine infrastructure hosts (archive.org, r.jina.ai, google.com, httpbin.org, relay.invalid), and a `# NOTE-BIAS-OK` comment convention for legitimate exemptions such as test fixtures.

```bash
python3 engine/bias_check.py       # fails on any site-specific leak
```

## FETCH CHAIN PHASES

```
fetch(url, ...)                                   # fetch_chain.py
  Phase 1  curl_probe.py    — curl_cffi TLS-impersonation probe
  Phase 2  grid             — referer/transform/device attempt grid
  Phase 2.5 surrogate.py    — third-party archive/reader/proxy routes
  Phase 3  executor.py      — capability-matched Playwright fallback
```

Ordering is **not** hardcoded: each `waf_profiles.yaml` profile carries a `fallback_when_challenge` list that drives the ladder. `surrogate_wayback` precedes browser executors in every profile, so archives are tried before paying for a browser spin-up.

## PROVENANCE / TRUST CONTRACT

`result_schema.py` puts two literals on every `FetchResult`:

- `Provenance = "live" | "snapshot" | "proxy"`
- `Trust = "origin" | "archive" | "untrusted"`

A `snapshot` result carries `snapshot_timestamp` and **must** be cited with that timestamp — never presented as the live page. `surrogates.yaml` `kind` fixes these values: `archive` -> snapshot/archive, `reader` -> live, `proxy` -> proxy/untrusted.

## SURROGATE REGISTRY (`surrogates.yaml`)

Site-agnostic infrastructure only. Every entry carries `last_verified` (ISO date); entries older than 90 days are deprioritized and flagged, because surrogate routes rot (a 2026-08 probe found 4 of 6 known routes dead or stubbed). `proxy` routes are MITM by construction: they require the explicit `--allow-proxy` flag and never receive `Cookie` or `Authorization` headers. Every surrogate response is re-validated with `target_url` set, so an interstitial or a redirect stub is rejected instead of returned as content.

## VALIDATOR LAYERS (`validators.py`)

```
L1    challenge markers (CHALLENGE_MARKERS)
L1.5  surrogate dead ends — interstitial titles + AMP-style redirect stubs
      (is_redirect_stub(), needs target_url)
L2    size/shape fingerprints
L3+   content checks
```

## CLI

```bash
python3 -m engine URL [--selector S] [--device auto|desktop|mobile]
                      [--timeout 25] [--max-attempts 12]
                      [--no-playwright] [--allow-proxy] [--json] [--trace]
```

## TESTS

`tests/` — `test_surrogate.py` (staleness, proxy gating, short-circuit), `test_surrogate_validators.py`, `test_fetch_chain.py`, `test_playwright_templates.py`, plus HTML/JSON fixtures under `tests/fixtures/`.

## NOTES

- `summary.py` emits an **R7 API-first hint** after >=3 challenge verdicts against a known WAF profile: look for `/api/`, `/graphql`, or `.json` endpoints, which usually carry weaker WAF protection than the HTML surface.
- `templates/` holds the Playwright JS templates (`playwright_real_chrome.js`, `playwright_mobile_chrome.js`) the executor drives.
- `url_transforms.py` transforms stay domain-agnostic (`mobile_subdomain`, `am_prefix`, `drop_www`).
- Parent: [`packages/shared-skills/AGENTS.md`](../../../AGENTS.md).

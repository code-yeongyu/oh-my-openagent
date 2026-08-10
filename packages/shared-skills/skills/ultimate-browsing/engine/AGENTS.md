# ultimate-browsing/engine — Generic WAF-Profile Fetch Chain (Python)

**Generated:** 2026-08-10 / 38d268995

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

# ATTRIBUTION / NOTICE

This skill (`ulw-research`, part of `@oh-my-opencode/shared-skills`) is authored by
the oh-my-openagent project. One design idea is adapted from a third-party project,
credited below. No third-party source is vendored here — only the verification idea
is adapted into this skill's prompt contract.

---

## 1. insane-research (fivetaku) — inspiration for the claim-graph verification gate

The non-code claim-graph verification gate (Phase 3b: a data-flow-lock where the
synthesis may assert a high-risk non-code claim only after it clears `>= 2 independent
source domains + 1 counter-search + a primary source`, otherwise it is abstained to an
unresolved/refuted annex) is inspired by the data-flow-lock verification design in
**insane-research** by fivetaku.

- Source: https://github.com/fivetaku/insane-research
- License: MIT (declared in the project's `README.md`).
- **What is adapted:** the IDEA only — a verification gate whose output is the sole
  allowlist the synthesis draws from, so skipping verification leaves nothing to
  synthesize. No insane-research code is copied or redistributed. The upstream gate is
  a Python checker (`validate_ledger.py`); this skill translates the concept into a
  runtime-agnostic prompt + message-text contract, because the Codex Light edition has
  no guaranteed Python.

```
MIT License

Copyright (c) 2026 fivetaku

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

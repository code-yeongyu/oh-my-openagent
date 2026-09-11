# GPT-6 Astra routing B1 plan

- Update category-model-requirements.ts only for visual-engineering, ultrabrain, deep, unspecified-high; leave agent requirements untouched.
- Add gpt-6 heuristic family and compatibility tests for max/aliases/temperature.
- Generalize OpenAI GPT fast alias rule to GPT-5.6 and GPT-6 Astra, update all named tests and model-core AGENTS row.
- Inspect generated snapshot and add supplemental Astra capability entry if required by the GPT-5.6 precedent; update guardrail tests.
- Add isGpt6Model and wire every GPT-5.6 frontier gate requested, preserving transport model IDs and GPT-5.5 prompt family; add identity.
- Add RED assertions before production edits, run remotely via bunshin, then implement and capture GREEN remotely.
- Update category/routing/invariant/fallback and sibling agent tests without deleting coverage.
- Add changes.md entry and resolved senpi evidence directory containing README, RED/GREEN logs, and resolution proof script.
- Run remote Bun tests and package typecheck via bunshin, commit atomically with explicit paths, push branch, open PR against dev, verify PR is OPEN and CI triggered.

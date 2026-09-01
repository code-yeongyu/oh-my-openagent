# ATTRIBUTION / NOTICE

This skill (`ulw-research`, authored natively for omo-senpi) is authored by
the oh-my-openagent project. Design ideas are adapted from the third-party
projects credited below. No third-party source is vendored here — only ideas
are adapted into this skill's prompt contract.

---

## 1. insane-research (fivetaku) — inspiration for the claim-graph verification gate

The non-code claim-graph verification gate (Phase 4b: a data-flow-lock where the
synthesis may assert a high-risk non-code claim only after it clears `>= 2 independent
source domains + 1 counter-search + a primary source`, otherwise it is abstained to an
unresolved/refuted annex) is inspired by the data-flow-lock verification design in
**insane-research** by fivetaku.

- Source: https://github.com/fivetaku/insane-research
- License: MIT (declared in the project's `README.md`).
- **What is adapted:** the IDEA only — a verification gate whose output is the sole
  allowlist the synthesis draws from, so skipping verification leaves nothing to
  synthesize. No insane-research code is copied or redistributed.

```
MIT License

Copyright (c) 2026 renocrypt
```

## 2. latex-paper-skills (yunshenwuchuxun) — citation verification + prose rhythm discipline

The verified-citation contract in `references/latex-report.md` (every bibliography
entry traces 1:1 to a source actually retrieved during the run, and citation
attachment is re-verified after any prose pass) and the citation-preserving rhythm
polish pass (vary sentence and paragraph length, kill filler phrases, minimize
structure-implied transitions, never move a `\cite`) are inspired by the gated
citation-verification workflow and the `latex-rhythm-refiner` skill in
**latex-paper-skills**.

- Source: https://github.com/yunshenwuchuxun/latex-paper-skills (snapshot d0f1061, 2026-03-25)
- License: MIT (Copyright (c) 2026 renocrypt; declared in the project's `LICENSE`).
- **What is adapted:** IDEAS only — no code, templates, or text are copied or
  redistributed. The upstream skills are agent-oriented prompt specs with Python
  validators; this skill translates the concepts into a runtime-agnostic reference
  read by the assembly lane.

## 3. latex-document-skill (ndpvt-web) — compile loop, page previews, scaling, long-form hygiene

The toolchain-detection order (latexmk, then xelatex/pdflatex, then tectonic), the
multi-pass compile loop with log-first debugging and PNG page previews for visual
QA, the empirical page-count scaling rule (1-10 / 11-20 / 21+ pages), the
engine-agnostic preamble pattern (`iftex`; XeLaTeX + fontspec for CJK), the report
template anatomy (geometry/fancyhdr/titlesec/hyperref/booktabs/pgfplots), and the
long-form anti-pattern list in `references/latex-report.md` are inspired by
**latex-document-skill**.

- Source: https://github.com/ndpvt-web/latex-document-skill (snapshot 54279f7, 2026-08-08)
- License: MIT.
- **What is adapted:** IDEAS only — no code, templates, or text are copied or
  redistributed. The upstream compile script and templates are not vendored; the
  reference describes the equivalent loop in plain shell + LaTeX.

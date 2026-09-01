# LaTeX Report Reference (ulw-research Phase 6)

Read this end to end when Phase 6 routes the final materials to LaTeX. It is the operational contract for producing a typeset research report: scaffold, compile, verify, polish. The deliverable is the compiled PDF plus the `.tex` sources, and the same two delivery gates apply (visual QA on rendered pages, then the `writing` proofread pass).

## When this route runs

LaTeX fits typeset, citation-heavy, or math-heavy reports: academic-flavored research deliverables, long documents that need a real table of contents and numbered bibliography, anything the user will print or submit. For a living page choose standalone HTML; for a working note choose Markdown. When the user asks for "LaTeX", ".tex", "academic paper style", or a typeset PDF, this is the route.

## Toolchain detection — run first, in one command

```bash
for b in latexmk xelatex pdflatex lualatex tectonic bibtex biber texfot pdftoppm; do command -v $b >/dev/null && echo "OK $b" || echo "-- $b"; done
```

- `latexmk` present → preferred backend (dependency-driven multi-pass, bibliography included).
- No `latexmk` → manual multi-pass with the detected engine.
- `tectonic` alone → usable as a zero-config fallback (`tectonic main.tex` self-manages passes and packages), but it is not a full TeX Live; avoid exotic packages.
- No engine at all → do NOT silently downgrade the deliverable. Ship the `.tex` sources, state plainly that no TeX toolchain exists on the machine, and offer the HTML→PDF route as the fallback. A promised PDF that was never compiled is a failed run.

## Engine choice

- Report language needs CJK (Korean/Japanese/Chinese) or heavy Unicode → **XeLaTeX**. Never force CJK through pdfLaTeX: it fails as silent mojibake, the worst class of error.
- Otherwise → pdfLaTeX is fine and fastest. LuaLaTeX when the user asks for it or Lua scripting is needed.

## The compile loop — non-negotiable

Compile from the report root (where `main.tex` lives):

```bash
# preferred
latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex        # add -xelatex for CJK
# manual fallback (engine = xelatex for CJK, else pdflatex)
<engine> -interaction=nonstopmode -halt-on-error main.tex
bibtex main            # or: biber main   (only when a .bib workflow is used)
<engine> -interaction=nonstopmode main.tex && <engine> -interaction=nonstopmode main.tex
```

1. Read the log every pass. Errors are lines starting with `!` — fix the FIRST one and re-run; later errors are usually cascade. When `texfot` exists, pipe through it to suppress package noise.
2. After errors: clear every `Undefined control sequence`, `Undefined references`, and `Citation ... undefined` (those mean another pass or a missing bib step), and every `Overfull \hbox` over 20pt (long URLs get `\url{}` or the `xurl` package; narrow columns get reworded or `\sloppy` locally).
3. Multi-pass is mandatory: TOC, cross-references, and citations only stabilize after 2-3 engine passes. latexmk does this for you; manual means you own the count.
4. Render page previews and LOOK at them — this is the visual-QA gate for this route:

```bash
pdftoppm -png -r 110 main.pdf page && ls page-*.png
```

Inspect every page: broken figures, overflowing tables, clipped CJK, blank pages, bad page breaks, unlabeled charts. Reading the `.tex` source is not visual QA. Fix and re-render until the pages are clean.
5. Remove aux files only after the PDF is accepted (`latexmk -c` or delete `*.aux *.log *.out *.toc *.bbl *.blg`).

## Preamble scaffold

Start from this, not from memory. It is engine-agnostic and carries the packages a research report actually needs:

```latex
\documentclass[11pt,a4paper]{article}
\usepackage{iftex}
\ifPDFTeX
  \usepackage[utf8]{inputenc}
  \usepackage[T1]{fontenc}
  \usepackage{lmodern}
\else
  \usepackage{fontspec}
\fi
\usepackage[a4paper,margin=1in]{geometry}
\usepackage{microtype}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{longtable}
\usepackage{float}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{fancyhdr}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage{tikz}
\usepackage{listings}
\definecolor{accent}{RGB}{0,102,204}   % the design-spec accent, one palette everywhere
\usepackage[colorlinks=true,linkcolor=accent,urlcolor=accent,citecolor=accent]{hyperref}

\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\textcolor{gray}{<Report title>}}
\fancyhead[R]{\small\textcolor{gray}{\today}}
\fancyfoot[C]{\small\thepage}
\titleformat{\section}{\Large\bfseries\color{accent}}{\thesection}{0.5em}{}
```

**CJK variant** — compile with XeLaTeX and replace the font block with a real installed CJK font (verify first with `fc-list | grep -i "cjk\|pretendard"`):

```latex
\usepackage{fontspec}
\setmainfont{Noto Serif CJK KR}      % or Pretendard, Noto Sans CJK KR — whatever fc-list proves exists
\setmainfont{Latin Modern Roman}     % optional: keep Latin in the report's serif
```

Fonts, colors, and heading style come from `design-spec.md` when one exists — one palette and one font family govern prose, charts, and diagrams alike; a figure in a random default font inside a styled report is a defect.

## Report skeleton

Map the ulw-research deliverable structure onto sections:

```latex
\title{\textbf{<Report title>}\\ \large <one-line scope>}
\author{ulw-research --- <members> members, <lanes> lanes, <waves> waves, <sources> sources}
\date{\today}
\begin{document}
\maketitle
\thispagestyle{empty}
\newpage
\tableofcontents
\newpage
\section{Executive Summary}      % 2-3 paragraphs answering the core question
\section{Key Findings by Theme}  % one subsection per theme; every claim carries \cite{srcN}
\section{Detailed Analysis}      % charts, tables, rendered diagrams, verification results
\section{Comparative Analysis}   % only when options compete
\section{Methodology}            % members, lanes, waves, searches, verifications, debate rounds
\section{Correction Log}         % what verification overturned
% bibliography at the end — see the citations section
\end{document}
```

Write the skeleton into `main.tex` FIRST with a `% STATUS: draft — <n> sections open` comment at the top, then fill sections as claims lock. An interrupted run leaves a partial report on disk, never an empty directory.

## Citations and the sources ledger

Every `[Source N]` in `SYNTHESIS.md` becomes a numbered bibliography entry, 1:1 with `sources-ledger.md`, in citation order, each carrying its access date. Two workable setups:

- **BibTeX/biblatex (preferred when bibtex/biber exists):** generate `refs.bib` from the ledger (`@misc` entries with `title`, `author` when known, `howpublished={\url{...}}`, `urldate`), cite with `\cite{srcN}`, style `plainnat` (natbib) or `style=numeric` (biblatex).
- **Manual `thebibliography` (zero extra tooling):** acceptable for pure web-source reports; one `\bibitem{srcN}` per ledger row.

The verification rule is absolute: **every bibliography entry was actually retrieved during the run.** An entry invented from memory, or one whose URL was never fetched, is a defect — the same standard the claim-graph gate enforces on prose. No citation without a ledger row; no ledger row without a citation.

## Figures, tables, code

- **Charts:** compute from real data (CSV/JSON under `$SESSION_DIR`), plot with matplotlib, save as **PDF vector** (PNG at 200+ dpi only when vector fails). Include with `\includegraphics[width=0.9\textwidth,keepaspectratio]{...}` inside `figure` with `\caption` + `\label`, and reference every figure in prose (`Figure~\ref{fig:x}`). A figure the text never references is a defect.
- **pgfplots** for native charts when the data is small and already in the preamble's style; matplotlib for anything computed. Never screenshot a chart from another tool.
- **Mermaid/diagrams:** render the `.mmd` to PNG or PDF FIRST (`mmdc -i in.mmd -o out.png -b white`), then include the image. Mermaid source never goes into the `.tex`.
- **Tables:** booktabs only — `\toprule`, `\midrule`, `\bottomrule`, NO vertical rules. `tabularx` for full-width text columns, `longtable` when rows can exceed a page, numeric columns right-aligned (`siunitx`'s `S` column when units matter). Every table gets `\caption` + `\label` + an in-text reference.
- **Code:** `listings` with a styled block (`basicstyle=\ttfamily\small`, `breaklines=true`, `frame=single`, `numbers=left`). Avoid `minted` unless `--shell-escape` is acceptable — prefer portability.
- **Float placement:** big figures/tables float with `[!htbp]`; reserve `[H]` (float package) for small exhibits that must sit exactly here. Never fight the float engine with `\newpage` spam.

## Long reports: split and scale

Empirical scaling holds here: 1-10 pages one assembly lane; 11-20 pages split at a section boundary across two lanes; 21+ pages batch ~7 pages per lane. Mechanically:

- One file per section under `sections/` (`sections/executive-summary.tex`, ...), `\input{sections/<name>}` from `main.tex`. Lanes own disjoint section files — no two lanes write the same file.
- The lead owns `main.tex`, the preamble, and the bibliography, and runs the compile loop after each merge.
- Compile after EVERY section merge, not once at the end — a 30-page report whose first compile happens at page 30 debugs thirty pages at once.

## The polish pass — after content, before final compile

Run one citation-preserving prose pass per section (the rhythm discipline):

- Vary sentence length: no 3+ consecutive sentences of similar length; mix short (5-12 words), medium (13-22), long (23-35).
- Alternate paragraph lengths: short for emphasis, medium for exposition, long for complex argument.
- Kill fillers: "in order to" → "to", "it is worth noting that" → delete, "due to the fact that" → "because", "a large number of" → "many".
- Drop transitions the structure already implies ("However,", "Moreover,", "As mentioned above,").
- Active voice; one main idea per paragraph with a clear first sentence.
- **Never add, move, or delete a `\cite{...}` while polishing.** Citation count and attachment are verified per section after the pass, not assumed.

## Pitfalls — the errors that actually happen

| Symptom in the log | Cause | Fix |
|---|---|---|
| `! Undefined control sequence` | typo'd command or missing `\usepackage` | read the line number; add the package or fix the command |
| `! Missing $ inserted` | `_`, `^`, or math chars in text mode | escape as `\_`, or wrap math in `$...$` |
| `! Misplaced alignment tab character &` | bare `&` in text | escape as `\&` (also `\%`, `\#`) |
| `! Illegal unit of measure` / `! Missing number` | typo'd dimension (`10 px`, `0.5\\textwidth` with `\` lost) | use real units and `\textwidth` fractions |
| `! LaTeX Error: Environment X undefined` | missing package or typo | add the package that owns the environment |
| Silent mojibake, no error | CJK under pdfLaTeX | switch to XeLaTeX + the CJK font block |
| `Overfull \hbox` (>20pt) | unbreakable long content (URLs, code, wide tables) | `\url{}`/`xurl`, `breaklines` in listings, shrink or restructure the table |
| `Citation 'srcN' undefined` | bib step missing or key typo | run bibtex/biber, then two more engine passes |
| `File not found` on `\includegraphics` | wrong relative path | paths are relative to `main.tex`, not to the section file |

Long-form anti-patterns to refuse while writing: walls of bullets where prose analysis belongs; `\newpage` after every section; oversized images without `keepaspectratio`; `[H]` on every float; uncompacted lists (`enumitem`'s `nosep` in tight spots); monotonous same-shape sections; hardcoded pixel dimensions instead of `\textwidth` fractions; widow/orphan lines at page breaks (`\usepackage[all]{nowidow}` when it matters).

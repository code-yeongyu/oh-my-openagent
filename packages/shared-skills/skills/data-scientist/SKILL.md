---
name: data-scientist
description: "Expert data processing with a hybrid engine strategy: resident-kernel engines first - DuckDB plus a resident Python stack (Polars/numpy/matplotlib) in persistent js/py eval kernels where the harness has them, bun/uv one-shots elsewhere - and per-action placement judgment (in-memory vs streaming vs remote-in-place). Triggers: 'analyze the data', 'what is in this CSV/parquet/json', 'summarize this', 'group by', 'filter rows', 'sort by', 'join these files', 'merge datasets', 'time series trend', 'compare yesterday and today', 'distribution/histogram', 'correlation', 'clean duplicates', 'handle missing values', 'dataset larger than RAM', 'SQL query on files', 'DataFrame operations', 'chart/plot this data', DuckDB vs Polars selection, quick data exploration CLI. NOT for plain text/code inspection, configs, or tiny inline math."
---

# Data Scientist: Hybrid-Engine Data Processing

Answer data questions through the cheapest engine and surface that can prove the answer, and
decide where the computation should live before touching the data.

## Execution surfaces: resident kernel first

A persistent REPL/eval kernel (many harnesses expose one for JavaScript and Python) is the
default surface. Reason: each one-shot process pays roughly a second of spawn-plus-import
overhead and re-scans the input file, while a resident connection amortizes both — after a
one-time load, repeat queries return in milliseconds. Exploration is repeat queries, so this
difference dominates the session.

1. **JavaScript kernel (Bun)**: run `scripts/ensure-js-deps.sh` once; it prints the absolute
   import path for `@duckdb/node-api`. Dynamic-import it, connect once, query across cells.
2. **Python kernel**: the default surface for Python work. duckdb/numpy/matplotlib are
   typically resident; Polars and pyarrow come from `scripts/ensure-py-deps.sh`, which
   installs them once into a user cache keyed to the kernel's interpreter —
   `sys.path.insert` the printed directory and import. The interpreter itself is never
   mutated.
3. **uv lane** (`uv run --with ...`): isolation for a heavy or crash-prone one-shot that
   should not take the kernel down.
4. **No kernel** (plain-shell harness): the same engines as one-shots — `bun -e` for
   DuckDB-js, `uv run python -c` for the Python stack — batching several questions per
   process.

Per-surface patterns and pitfalls: read `references/execution-surfaces.md` before first use.

## Engine selection

- **DuckDB** for SQL-shaped work: direct file queries, joins, aggregation, subqueries,
  window functions. It queries CSV/Parquet/JSON in place without loading, spills to disk
  past its memory limit, and reads remote files with the same syntax.
- **Polars** when the pipeline is DataFrame-shaped: expression-chain transforms, reshapes,
  streaming datasets past RAM — resident in the Python kernel via `ensure-py-deps.sh`.
  Read `references/polars-lane.md` — the current 1.x API differs from widely-memorized
  older spellings.
- **numpy** when numeric work goes beyond SQL/DataFrame aggregation: statistical tests,
  linear algebra, FFT, random sampling.
- **matplotlib** for every chart — read `references/visualization.md` first; it carries the
  quality bar and a mandatory visual check.

Performance folklore ("X is Nx faster at filtering") varies with data shape, cardinality,
and hardware. When the engine choice materially matters, measure on the actual data instead
of trusting remembered multipliers.

## Placement: decide where the computation lives

Probe before you compute — one cell: file size, free RAM, and (when unclear) a row count via
a direct scan. Then place the work:

- **Load into memory** when the working set stays within roughly a quarter of free RAM AND
  the session will run repeated queries: `CREATE TABLE t AS SELECT ...` (or a collected
  DataFrame) once, then iterate. One scan up front converts every later query from a file
  re-scan into milliseconds.
- **Query in place / stream** when the question is single-pass, or the data exceeds RAM:
  DuckDB reads files directly (`FROM 'data.csv'`); past RAM, cap DuckDB's memory and let it
  spill, or use Polars' streaming engine in the Python kernel. NEVER load a larger-than-RAM
  dataset fully into memory — swapping stalls the whole machine, while streaming merely
  takes longer.
- **Query remotely, in place** when the data lives elsewhere: DuckDB reads http(s)/S3
  Parquet and CSV with projection and predicate pushdown, so fetch the columns and rows the
  question needs, never the whole file. When data sits on another machine you can execute
  on, ship the query to the data and return the small result. Rule: result much smaller
  than data — move the query; repeated local iteration planned — move a pruned copy of the
  data once.

Sizing heuristics and recipes: `references/placement.md`.

## Hard rules

- **NEVER use pandas.** DuckDB and Polars beat it decisively on every workload this skill
  covers, and the environments this skill assumes do not ship it — `.df()` on a DuckDB
  result raises unless pandas is installed; convert with `.pl()` via Arrow instead.
- Excel files are not read directly: export to CSV or Parquet first.

## Output contract

Answer the question; report row counts and timing for anything heavy; then stop — no bonus
charts, no extra exploration passes beyond what the question needed. Chart when asked, or
when the answer is a shape (trend, distribution, comparison) that prose cannot carry — then
follow `references/visualization.md` including its visual QA step.

## References

| Read | When |
| --- | --- |
| `references/execution-surfaces.md` | before the first query on any surface: kernel patterns, one-shot recipes, escalation rules |
| `references/polars-lane.md` | DataFrame-shaped pipeline or data past RAM: current API, Arrow handoff, package sets |
| `references/placement.md` | before heavy or remote work: sizing probe, memory limits, remote reads |
| `references/visualization.md` | before any chart: type selection, quality bar, CJK fonts, visual QA |
| `references/uv-setup.md` | uv missing or broken on this machine |

## CLI fallback

When no kernel or REPL surface exists, `uv run scripts/quick-query.py <file> [SQL]`
(`--filter <polars-sql-expr>`, `--describe`) answers ad-hoc questions with zero code.
Supports CSV, Parquet, JSON, NDJSON.

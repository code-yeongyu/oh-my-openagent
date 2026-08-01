# Performance Benchmarks

Routing heuristics distilled from public 2024-2025 results in the [db-benchmark suite](https://github.com/h2oai/db-benchmark) (rendered at [h2oai.github.io/db-benchmark](https://h2oai.github.io/db-benchmark/)) and from the vendors' own documentation ([duckdb.org](https://duckdb.org/), [pola.rs](https://pola.rs/)).

**Read these as routing guidance, not guarantees.** Multipliers vary with dataset size, cardinality, data types, and hardware. When the choice materially matters, measure on the actual data.

## Operation Performance Comparison

| Operation Type      | Winner      | Indicative advantage | When to Use                                    |
|---------------------|-------------|----------------------|------------------------------------------------|
| **Filtering**       | **Polars**  | often the fastest by a wide margin (SIMD, predicate pushdown) | Single-table filters |
| **Sorting**         | **Polars**  | typically the fastest | ORDER BY operations, ranking                   |
| **Joins**           | **DuckDB**  | typically faster; richer join types | Multi-table joins, especially complex joins    |
| **Aggregations**    | **DuckDB**  | typically faster on large datasets | GROUP BY, complex aggregations                 |
| **Window Funcs**    | **Polars**  | typically faster | RANK, LAG/LEAD, running totals                 |
| **Transformations** | **Polars**  | typically faster | Pivot, melt, string operations                 |
| **Direct Query**    | **DuckDB**  | avoids loading to memory entirely | Ad-hoc exploration without loading to memory   |
| **Streaming**       | **Polars**  | handles datasets larger than RAM | Datasets larger than RAM                       |

Both tools are decisively faster than pandas on 1M+ row workloads, which is why pandas is banned outright in this skill.

## Operation Detection Keywords

Automatically detect operation types from user requests:

- **Filter**: "where", "filter", "condition", "select rows", "find"
- **Sort**: "sort", "order", "top", "bottom", "rank"
- **Join**: "join", "merge", "combine tables"
- **Aggregate**: "group", "sum", "avg", "count", "mean", "total", "aggregate"
- **Transform**: "pivot", "melt", "reshape", "string operations", "clean", "transform"
- **Window**: "running", "cumulative", "lag", "lead", "rank", "partition"

## Benchmarking Notes

- Public suites exercise typical analytical workloads (1M-100M rows).
- Performance advantages are approximate and vary by dataset characteristics.
- Real-world performance depends on data types, cardinality, and hardware.

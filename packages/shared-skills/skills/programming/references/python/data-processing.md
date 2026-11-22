# Data Processing — Polars + DuckDB

## The rule

NEVER pandas. Polars (with numpy) plus DuckDB. Pandas is 10-50x slower, has weaker types, and the modern Python data ecosystem has moved on.

## Quick decision tree

| Operation | Use | Why |
|---|---|---|
| `.csv` / `.parquet` / `.json` direct query | DuckDB | Zero memory load, SQL ergonomics |
| `.duckdb` file | DuckDB | Native format |
| Filter (any size) | Polars | row-wise filtering, low setup cost |
| Sort | Polars | in-memory sorting |
| Multi-table join | DuckDB | more join types, out-of-core joins |
| Heavy GROUP BY aggregation | DuckDB | large grouped aggregation |
| Window function | Polars | window expressions |
| Pivot / melt / string ops | Polars | reshape and string expressions |
| Larger than RAM | Polars streaming or DuckDB out-of-core | Both handle OOM |
| Mixed pipeline | Hybrid (zero-copy via Arrow) | Use each tool's strengths |

For the deep version (engine choice, placement, OOM strategies, execution templates), load the **`data-scientist`** skill - it lives in this same skill set; when the engine choice matters, measure on the actual data, as that skill says.

## Standard imports

```python
import numpy as np
import polars as pl
import duckdb
```

## DuckDB direct file query (zero memory load)

```python
result = duckdb.sql("""
    SELECT category, SUM(amount) AS total
    FROM 'data.csv'
    WHERE date >= '2026-01-01'
    GROUP BY category
    ORDER BY total DESC
""").pl()  # zero-copy → Polars DataFrame
```

`.pl()` returns Polars; `.df()` would return pandas - never use `.df()`.

## Polars lazy pipeline

```python
result = (
    pl.scan_csv("data.csv")              # lazy, no read yet
    .filter(pl.col("amount") > 1000)
    .filter(pl.col("status") == "active")
    .sort("amount", descending=True)
    .head(100)
    .collect()                            # execute optimised plan
)
```

`scan_*` over `read_*` for files; `lazy()` then `collect()` for in-memory frames. Polars optimises the entire plan before execution (predicate pushdown, projection pushdown, common subexpression elimination).

## Streaming for OOM data

```python
result = (
    pl.scan_csv("huge.csv")
    .filter(pl.col("active"))
    .group_by("category")
    .agg([
        pl.len().alias("count"),
        pl.sum("amount").alias("total"),
    ])
    .collect(engine="streaming")
)
```

## Hybrid pipeline (most realistic shape)

```python
# Phase 1: DuckDB for the join (3x faster)
joined = duckdb.sql("""
    SELECT o.*, c.region, p.category
    FROM 'orders.parquet' o
    JOIN 'customers.parquet' c ON o.customer_id = c.id
    JOIN 'products.parquet'  p ON o.product_id  = p.id
""").pl()

# Phase 2: Polars for filtering and transformation
processed = (
    joined
    .filter(pl.col("amount") > 100)
    .with_columns([
        (pl.col("amount") * 1.1).alias("amount_with_tax"),
    ])
)

# Phase 3: DuckDB for final aggregation (4x faster) - register Polars frame by name
duckdb.register("processed", processed)
final = duckdb.sql("""
    SELECT region, category, SUM(amount_with_tax) AS revenue
    FROM processed
    GROUP BY region, category
    ORDER BY revenue DESC
""").pl()
```

## Type safety with Polars

Polars supports schema overrides at read time, and `.cast()` for explicit conversion. Avoid implicit coercion in hot paths.

```python
schema = {"id": pl.Int64, "amount": pl.Float64, "date": pl.Date}
df = pl.read_csv("data.csv", schema_overrides=schema)
```

basedpyright understands `polars-stubs`, which ship with polars itself. No extra type stubs to install.

## Things you might miss from pandas (and how to do them in Polars)

| pandas | polars |
|---|---|
| `df.iloc[5]` | `df.row(5)` (named tuple) or `df[5]` (single-row frame) |
| `df.loc[df["x"] > 5]` | `df.filter(pl.col("x") > 5)` |
| `df["x"].apply(fn)` | `df["x"].map_elements(fn)` (slow path) or use native expressions |
| `df.merge(...)` | `df.join(other, on="key")` |
| `df.groupby(...).agg(...)` | `df.group_by(...).agg(...)` |
| `pd.read_csv(...).dtypes` | `pl.read_csv(...).schema` |
| `df.to_dict("records")` | `df.to_dicts()` |

## Sources

- Polars docs: <https://docs.pola.rs>
- DuckDB Python API: <https://duckdb.org/docs/api/python/overview>
- Cross-reference - this skill set's `data-scientist` skill (load it for the deep version)

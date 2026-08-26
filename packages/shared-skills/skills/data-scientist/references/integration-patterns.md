# Integration Patterns: DuckDB ↔ Polars

## Zero-Copy Conversions (FASTEST)

### DuckDB → Polars (Recommended)

```python
import duckdb
import polars as pl

# Direct conversion with .pl() - zero-copy via Arrow
df_polars = duckdb.sql("""
    SELECT * FROM 'data.parquet'
    WHERE amount > 100
""").pl()  # Returns Polars DataFrame directly

# Lazy version for large datasets
lazy_df = duckdb.sql("SELECT * FROM 'data.parquet'").pl(lazy=True)
result = lazy_df.filter(pl.col('status') == 'active').collect()
```

### Polars → DuckDB (Direct Reference)

```python
import duckdb
import polars as pl

# DuckDB can query Polars DataFrames directly by name
df = pl.read_parquet('data.parquet')

result = duckdb.sql("""
    SELECT category, SUM(amount) as total
    FROM df
    GROUP BY category
    ORDER BY total DESC
""").pl()  # Query df directly, return as Polars
```

### Via Arrow (When Needed)

```python
# Polars → Arrow → DuckDB
df_polars = pl.read_csv('data.csv')
duckdb.register('my_table', df_polars.to_arrow())

# DuckDB → Arrow → Polars
arrow_table = duckdb.sql("SELECT * FROM data").arrow()
df_polars = pl.from_arrow(arrow_table)
```

## WRONG vs RIGHT Patterns

### ❌ NEVER - Using Pandas

```python
# FORBIDDEN - decisively slower than Polars/DuckDB on every operation!
import pandas as pd
df = pd.read_csv('data.csv')
result = df.groupby('category')['amount'].sum()
```

### ✅ CORRECT - DuckDB for simple aggregation query

```python
import duckdb
# Direct file query - no memory loading!
result = duckdb.sql("""
    SELECT category, SUM(amount) as total
    FROM 'data.csv'
    GROUP BY category
""").pl()  # Fast, memory-efficient
```

### ❌ NEVER - Loading file before DuckDB query

```python
# WRONG - Unnecessary memory usage
import polars as pl
import duckdb
df = pl.read_csv('data.csv')  # Loads entire file
result = duckdb.sql("SELECT * FROM df WHERE amount > 100").pl()
```

### ✅ CORRECT - Let DuckDB query directly

```python
import duckdb
# DuckDB queries file directly - much faster!
result = duckdb.sql("""
    SELECT * FROM 'data.csv'
    WHERE amount > 100
""").pl()
```

### ❌ NEVER - Eager evaluation in Polars

```python
# WRONG - Loads everything immediately
import polars as pl
df = pl.read_csv('large_data.csv')  # Eager load
filtered = df.filter(pl.col('value') > 100)
```

### ✅ CORRECT - Lazy evaluation

```python
import polars as pl
# Lazy - builds query plan, optimizes, executes once
df = pl.scan_csv('large_data.csv')  # Lazy
result = (
    df
    .filter(pl.col('value') > 100)
    .groupby('category')
    .agg(pl.sum('value'))
    .collect()  # Execute optimized plan
)
```

### ❌ NEVER - Unnecessary Conversions

```python
# WASTEFUL (DuckDB → Pandas → Polars)
import duckdb, pandas as pd, polars as pl
df_pd = duckdb.sql("SELECT * FROM 'data.csv'").df()  # requires pandas - the skill never ships it
df_pl = pl.from_pandas(df_pd)
```

### ✅ CORRECT - Direct conversion

```python
# DIRECT (DuckDB → Polars via Arrow)
import duckdb
df_pl = duckdb.sql("SELECT * FROM 'data.csv'").pl()
```

### ❌ NEVER - Wrong tool for heavy filtering

```python
# SLOW (DuckDB not optimal for filtering)
import duckdb
result = duckdb.sql("""
    SELECT * FROM 'huge.csv'
    WHERE complex_filter = true
""").pl()
```

### ✅ CORRECT - Use Polars for filtering

```python
# FAST (Polars 128x faster for filtering)
import polars as pl
result = pl.scan_csv('huge.csv').filter(pl.col('complex_filter')).collect()
```

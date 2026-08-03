# Common Scenarios with Tool Selection

## Scenario 1: Simple Calculation

**Decision: Python (always)**

```python
uv run --with numpy python -c "
import numpy as np
result = np.sum([1, 2, 3, 4, 5])
print(f'Result: {result}')
"
```

## Scenario 2: CSV Quick Analysis

**Decision: DuckDB (direct query, no memory load)**

```python
uv run --with numpy --with duckdb python -c "
import duckdb
result = duckdb.sql('''
    SELECT * FROM 'data.csv'
    LIMIT 10
''').pl()
print(result)
"
```

## Scenario 3: Filter + Sort on Large Dataset

**Decision: Polars (128x faster filtering, 12x faster sorting)**

```python
uv run --with numpy --with polars python -c "
import polars as pl
result = (
    pl.scan_csv('large.csv')
    .filter(pl.col('value') > 1000)
    .sort('value', descending=True)
    .head(100)
    .collect()
)
print(result)
"
```

## Scenario 4: Multi-Table Join + Aggregation

**Decision: DuckDB (best for joins and aggregations)**

```python
uv run --with numpy --with duckdb python -c "
import duckdb
result = duckdb.sql('''
    SELECT
        a.category,
        COUNT(*) as count,
        SUM(b.amount) as total
    FROM 'table1.csv' a
    JOIN 'table2.csv' b ON a.id = b.id
    GROUP BY a.category
    ORDER BY total DESC
''').pl()
print(result)
"
```

## Scenario 5: Data Exploration

**Decision: DuckDB for quick exploration**

```python
uv run --with numpy --with duckdb python -c "
import duckdb

# Show first few rows
print('**Sample Data**')
print(duckdb.sql('SELECT * FROM \"data.csv\" LIMIT 5').pl())

# Show summary statistics
print('\\n**Summary Statistics**')
print(duckdb.sql('DESCRIBE SELECT * FROM \"data.csv\"').pl())

# Show row count
print('\\n**Row Count**')
print(duckdb.sql('SELECT COUNT(*) as total_rows FROM \"data.csv\"').pl())
"
```

## Scenario 6: Time-Series Analysis

**Decision: DuckDB for aggregation + matplotlib for visualization**

```python
uv run --with numpy --with duckdb --with pyarrow --with matplotlib python -c "
import duckdb
import matplotlib.pyplot as plt

# Aggregate by date
result = duckdb.sql('''
    SELECT
        DATE_TRUNC('day', timestamp) as date,
        COUNT(*) as count,
        AVG(value) as avg_value
    FROM 'timeseries.csv'
    GROUP BY date
    ORDER BY date
''').pl()

# Plot
plt.figure(figsize=(12, 6))
plt.subplot(2, 1, 1)
plt.plot(result['date'], result['count'])
plt.title('Daily Count')

plt.subplot(2, 1, 2)
plt.plot(result['date'], result['avg_value'])
plt.title('Daily Average Value')

plt.tight_layout()
plt.savefig('timeseries.png')
print('Saved to timeseries.png')
"
```

## Scenario 7: Complex Transformation

**Decision: Polars for efficient transformations**

```python
uv run --with numpy --with polars python -c "
import polars as pl

result = (
    pl.scan_csv('data.csv')
    .with_columns([
        # Create new calculated columns
        (pl.col('price') * pl.col('quantity')).alias('total'),
        pl.col('date').str.strptime(pl.Date, '%Y-%m-%d').alias('parsed_date'),
        pl.col('name').str.to_uppercase().alias('upper_name'),
    ])
    .filter(pl.col('total') > 100)
    .select(['parsed_date', 'upper_name', 'total'])
    .collect()
)

print(result)
"
```

## Scenario 8: Large File Processing

**Decision: Polars streaming mode**

```python
uv run --with numpy --with polars python -c "
import polars as pl

# Process file larger than RAM
result = (
    pl.scan_csv('huge_file.csv')
    .filter(pl.col('active') == True)
    .groupby('category')
    .agg([
        pl.count().alias('count'),
        pl.sum('amount').alias('total'),
        pl.mean('amount').alias('average'),
    ])
    .collect(streaming=True)  # Streaming mode
)

print(result)
print(f'\\nProcessed {result[\"count\"].sum():,} rows')
"
```

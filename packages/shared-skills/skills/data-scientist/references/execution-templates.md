# Execution Templates

## Template 1: DuckDB for Simple/Complex SQL Queries

**Use when:**
- Simple aggregation on single file
- Complex multi-table joins
- Heavy GROUP BY operations
- Window functions with complex SQL logic
- Ad-hoc exploration queries

```python
uv run --with numpy --with duckdb python -c "
import duckdb

# Simple query - direct file access
result = duckdb.sql('''
    SELECT
        category,
        COUNT(*) as count,
        AVG(amount) as avg_amount,
        SUM(amount) as total
    FROM 'data.csv'
    WHERE date >= '2024-01-01'
    GROUP BY category
    ORDER BY total DESC
    LIMIT 10
''').pl()

print('**Results**')
print(result)
print(f'\\nProcessed {len(result)} categories')
"
```

## Template 2: Polars for Filtering & Sorting

**Use when:**
- Primary operation is filtering large dataset
- Sorting required
- Chain transformations
- Memory-efficient processing needed

```python
uv run --with numpy --with polars python -c "
import polars as pl

# Lazy evaluation for optimal performance
result = (
    pl.scan_csv('data.csv')  # Lazy scan
    .filter(
        (pl.col('amount') > 1000) &
        (pl.col('status') == 'active') &
        (pl.col('date') >= '2024-01-01')
    )
    .sort('amount', descending=True)
    .head(100)
    .collect()  # Execute optimized plan
)

print('**Filtered and Sorted Results**')
print(result)
print(f'\\nFound {len(result)} matching rows')
"
```

## Template 3: Hybrid Approach (Best of Both)

**Use when:**
- Need joins AND heavy filtering
- Complex SQL followed by transformations
- Optimize different operation stages

```python
uv run --with numpy --with duckdb --with polars --with pyarrow python -c "
import duckdb
import polars as pl

print('Phase 1: DuckDB for complex join (3x faster)')
# DuckDB excels at joins
joined = duckdb.sql('''
    SELECT
        o.order_id,
        o.amount,
        c.customer_id,
        c.region,
        p.category
    FROM 'orders.csv' o
    JOIN 'customers.csv' c ON o.customer_id = c.customer_id
    JOIN 'products.csv' p ON o.product_id = p.product_id
    WHERE o.date >= '2024-01-01'
''').pl()  # Convert to Polars

print(f'Joined {len(joined):,} rows')

print('\\nPhase 2: Polars for ultra-fast filtering (128x faster)')
# Polars excels at filtering
filtered = (
    joined
    .filter(
        (pl.col('amount') > 100) &
        (pl.col('region').is_in(['North', 'South', 'East']))
    )
    .with_columns([
        (pl.col('amount') * 1.1).alias('amount_with_tax')
    ])
)

print(f'Filtered to {len(filtered):,} rows')

print('\\nPhase 3: DuckDB for final aggregation (4x faster)')
# Back to DuckDB for aggregation
duckdb.register('filtered_data', filtered)
final = duckdb.sql('''
    SELECT
        region,
        category,
        COUNT(DISTINCT customer_id) as customers,
        SUM(amount_with_tax) as total_revenue,
        AVG(amount_with_tax) as avg_transaction
    FROM filtered_data
    GROUP BY region, category
    HAVING total_revenue > 10000
    ORDER BY total_revenue DESC
''').pl()

print('\\n**Final Results**')
print(final)
"
```

## Template 4: Polars Streaming for Large Files

**Use when:**
- Dataset larger than available RAM
- Need to process data in batches
- Memory constraints

```python
uv run --with numpy --with polars python -c "
import polars as pl

# Streaming mode - processes data in chunks
result = (
    pl.scan_csv('huge_file.csv')
    .filter(pl.col('status') == 'active')
    .with_columns([
        (pl.col('amount') * 1.1).alias('adjusted_amount')
    ])
    .groupby('category')
    .agg([
        pl.sum('adjusted_amount').alias('total'),
        pl.count().alias('count')
    ])
    .collect(streaming=True)  # Streaming mode for large data
)

print('**Streaming Results**')
print(result)
print(f'\\nProcessed {result[\"count\"].sum():,} total rows')
"
```

## Template 5: Visualization with Matplotlib

**Use when:**
- User requests charts, graphs, or plots
- Exploratory data analysis (EDA)
- Time-series or distribution analysis

```python
uv run --with numpy --with duckdb --with polars --with pyarrow --with matplotlib python -c "
import duckdb
import matplotlib.pyplot as plt

# Query data
result = duckdb.sql('''
    SELECT
        date,
        SUM(amount) as total
    FROM 'data.csv'
    GROUP BY date
    ORDER BY date
''').pl()

# Create visualization
plt.figure(figsize=(10, 6))
plt.plot(result['date'], result['total'])
plt.xlabel('Date')
plt.ylabel('Total Amount')
plt.title('Daily Total Trends')
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('output.png')
print('Chart saved to output.png')
"
```

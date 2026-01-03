# Database Operations Skill

Database management, query optimization, schema operations, and data migration for SQL and NoSQL databases.

## Commands

### `/db query <sql>`

Execute a database query and display results.

**Arguments:**
- `sql` (required): SQL query to execute
- `--database`: Database connection name (default: default)
- `--limit`: Maximum rows to return (default: 100)
- `--format`: Output format: table, json, csv (default: table)

**Example:**
```
/db query "SELECT * FROM users WHERE active = true"
/db query "SELECT COUNT(*) FROM orders GROUP BY status" --format json
/db query "SELECT * FROM products" --database analytics --limit 1000
```

### `/db schema [table]`

View or manage database schema.

**Arguments:**
- `table` (optional): Table name (shows all tables if not specified)
- `--action`: Schema action: show, create, alter, drop (default: show)
- `--database`: Database connection name

**Example:**
```
/db schema
/db schema users
/db schema --action create orders
```

### `/db migrate <action>`

Manage database migrations.

**Arguments:**
- `action` (required): Migration action: status, up, down, create, generate
- `--name`: Migration name (for create)
- `--steps`: Number of migrations (for up/down)
- `--dry-run`: Show SQL without executing

**Example:**
```
/db migrate status
/db migrate up
/db migrate up --steps 3
/db migrate down --steps 1
/db migrate create add_user_roles
/db migrate generate --from-diff
```

### `/db analyze [table]`

Analyze database performance and statistics.

**Arguments:**
- `table` (optional): Specific table to analyze
- `--slow-queries`: Include slow query analysis
- `--database`: Database connection name

**Example:**
```
/db analyze
/db analyze users
/db analyze --slow-queries
```

### `/db optimize <target>`

Optimize queries, tables, or indexes.

**Arguments:**
- `target` (required): What to optimize: query, table, index
- `--query`: SQL query to optimize
- `--table`: Table to optimize

**Example:**
```
/db optimize query --query "SELECT * FROM orders WHERE user_id = 123"
/db optimize table --table orders
/db optimize index --table users
```

### `/db explain <query>`

Explain query execution plan.

**Arguments:**
- `query` (required): SQL query to explain
- `--analyze`: Run EXPLAIN ANALYZE (executes query)
- `--format`: Output format: text, json, yaml

**Example:**
```
/db explain "SELECT * FROM orders JOIN users ON orders.user_id = users.id"
/db explain "SELECT * FROM products WHERE category = 'electronics'" --analyze
```

### `/db backup <target>`

Create database backup.

**Arguments:**
- `target` (required): Output file path
- `--format`: Backup format: sql, binary, archive
- `--compress`: Compress backup
- `--tables`: Specific tables to backup

**Example:**
```
/db backup ./backups/db-2026-01-03.sql
/db backup ./backups/db.dump --format binary --compress
/db backup ./backups/users.sql --tables users,user_roles
```

### `/db seed <source>`

Seed database with test data.

**Arguments:**
- `source` (required): Seed file or directory
- `--table`: Specific table to seed
- `--truncate`: Truncate table before seeding
- `--count`: Number of records (for generated data)

**Example:**
```
/db seed ./seeds/
/db seed ./seeds/users.json --truncate
/db seed generate --table users --count 1000
```

## Integrations

### PostgreSQL MCP

Native PostgreSQL integration.

**Environment variables:**
- `POSTGRES_HOST`: Database host (default: localhost)
- `POSTGRES_PORT`: Database port (default: 5432)
- `POSTGRES_USER`: Database user
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_DB`: Database name

Or use connection URI:
- `DATABASE_URL`: PostgreSQL connection string

### MySQL MCP

Native MySQL/MariaDB integration.

**Environment variables:**
- `MYSQL_HOST`: Database host (default: localhost)
- `MYSQL_PORT`: Database port (default: 3306)
- `MYSQL_USER`: Database user
- `MYSQL_PASSWORD`: Database password
- `MYSQL_DATABASE`: Database name

### MongoDB MCP

MongoDB document database integration.

**Environment variables:**
- `MONGODB_URI`: MongoDB connection string
- `MONGODB_DATABASE`: Default database name

### SQLite MCP

SQLite file-based database integration.

**Environment variables:**
- `SQLITE_PATH`: Path to SQLite database file

### Redis MCP

Redis key-value store integration.

**Environment variables:**
- `REDIS_URL`: Redis connection URL (default: redis://localhost:6379)

## Supported Databases

| Database | Query | Schema | Migrate | Analyze | Optimize | Explain |
|----------|-------|--------|---------|---------|----------|---------|
| PostgreSQL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MySQL/MariaDB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SQLite | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MongoDB | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Redis | ✅ | ⚠️ | ❌ | ✅ | ❌ | ❌ |
| Elasticsearch | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |

## Use Cases

### Query Development
```
/db explain "SELECT * FROM orders WHERE created_at > '2026-01-01'"
/db optimize query --query "SELECT * FROM orders WHERE user_id = 123"
```

### Schema Management
```
/db schema
/db migrate create add_order_status
/db migrate up
```

### Performance Analysis
```
/db analyze --slow-queries
/db optimize table --table orders
```

### Data Operations
```
/db backup ./backups/production.sql --compress
/db seed ./seeds/test-data.json --truncate
```

## Best Practices

1. **Always use parameterized queries**: Prevent SQL injection
2. **Explain before optimizing**: Understand the query plan first
3. **Regular analysis**: Run `/db analyze` periodically
4. **Test migrations**: Use `--dry-run` before applying
5. **Backup before migrate**: Always backup before schema changes
6. **Index wisely**: More indexes = slower writes

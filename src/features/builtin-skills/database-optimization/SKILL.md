---
name: database-optimization
description: Database performance optimization and query analysis
triggers:
  - database optimization
  - query performance
  - N+1 detection
  - index analysis
---

# Database Optimization Skill

## Purpose
Optimize database queries and schema for performance.

## Checklist
1. Index analysis - missing/unused indexes
2. N+1 query detection
3. Query EXPLAIN analysis
4. Connection pooling review
5. Schema denormalization opportunities

## Patterns to Detect
- SELECT * usage
- Missing WHERE indexes
- Excessive JOINs
- Unbounded queries (no LIMIT)

---
description: Analyze code for performance bottlenecks and provide optimization recommendations.
---

# Optimize Performance

## Overview

Analyze the current code for performance bottlenecks and provide optimization recommendations. Focus on algorithms, memory usage, and efficient patterns.

## User Input

```text
$ARGUMENTS
```

## Steps

1. **Performance Analysis**
   - Identify slow algorithms and inefficient data structures
   - Find memory leaks and excessive allocations
   - Detect unnecessary computations and redundant operations
   - Analyze database queries and API calls

2. **Identify bottlenecks**
   - Profile critical paths
   - Measure time complexity
   - Check memory usage patterns
   - Identify N+1 query problems

3. **Optimization Strategies**
   - Suggest algorithm improvements and better data structures
   - Recommend caching strategies where appropriate
   - Propose lazy loading and pagination solutions
   - Identify opportunities for parallel processing

4. **Implement optimizations**
   - Provide optimized code with explanations
   - Include performance impact estimates
   - Suggest profiling and monitoring approaches
   - Consider trade-offs between performance and maintainability

5. **Validate improvements**
   - Measure before/after performance
   - Ensure functionality preserved
   - Document optimization rationale

6. **Call Historian** (GOVERNANCE):
   - Read `.opencode/agent/historian.md`
   - Create changelog entry for optimization work
   - Include: bottlenecks identified, optimizations applied, performance gains

## Performance Checklist

- [ ] Algorithms optimized
- [ ] Memory usage improved
- [ ] Unnecessary computations removed
- [ ] Caching implemented where beneficial
- [ ] Database queries optimized
- [ ] Async operations used appropriately
- [ ] Performance measured and documented

## References

- Historian: `.opencode/agent/historian.md`
- Performance Requirements: `.cursor/memory/constitution.md`

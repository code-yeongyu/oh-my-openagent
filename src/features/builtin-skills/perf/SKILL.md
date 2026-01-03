# Performance Analysis Skill

Performance profiling, benchmarking, and optimization analysis for identifying bottlenecks and improving application performance.

## Commands

### `/perf profile <target>`

Capture CPU or memory profile of a program or function.

**Arguments:**
- `target` (required): Program path, URL, or function reference
- `--type`: Profile type: cpu, memory, heap, wall, io, lock (default: cpu)
- `--duration`: Profile duration in seconds (default: 30)
- `--sample-rate`: Samples per second (default: 1000)
- `--format`: Output format: flamegraph, json, pprof (default: flamegraph)

**Example:**
```
/perf profile ./src/server.ts --type cpu --duration 60
/perf profile http://localhost:3000/api/users --type memory
/perf profile "npm run test" --format pprof
```

### `/perf trace <target>`

Trace execution flow and async operations.

**Arguments:**
- `target` (required): Program or script to trace
- `--type`: Trace type: async, sync, all (default: all)
- `--depth`: Maximum call stack depth (default: 100)
- `--args`: Include function arguments in trace

**Example:**
```
/perf trace ./src/main.ts --type async
/perf trace "bun run build" --depth 50
```

### `/perf benchmark <target>`

Run performance benchmarks with statistical analysis.

**Arguments:**
- `target` (required): Benchmark file or function
- `--iterations`: Number of iterations (default: 1000)
- `--warmup`: Warmup iterations (default: 100)
- `--name`: Benchmark name for comparison
- `--baseline`: Compare against named baseline

**Example:**
```
/perf benchmark src/utils/parser.bench.ts
/perf benchmark parseJSON --iterations 10000 --name "v2"
/perf benchmark parseJSON --baseline "v1"
```

### `/perf analyze [profile]`

Analyze profile data and identify bottlenecks.

**Arguments:**
- `profile` (optional): Profile file path (uses latest if not specified)
- `--threshold`: Minimum time percentage to report (default: 1%)

**Example:**
```
/perf analyze
/perf analyze ./profiles/cpu-2026-01-03.json
/perf analyze --threshold 5
```

### `/perf compare <baseline> <current>`

Compare two profiles or benchmark results.

**Arguments:**
- `baseline` (required): Baseline profile/benchmark
- `current` (required): Current profile/benchmark

**Example:**
```
/perf compare profiles/v1.json profiles/v2.json
/perf compare baseline-bench current-bench
```

### `/perf flamegraph <profile>`

Generate interactive flamegraph visualization.

**Arguments:**
- `profile` (required): Profile file path
- `--output`: Output file path (default: flamegraph.svg)
- `--title`: Chart title

**Example:**
```
/perf flamegraph ./profiles/cpu.json --output cpu-flame.svg
```

### `/perf memory <target>`

Analyze memory usage and detect leaks.

**Arguments:**
- `target` (required): Program to analyze
- `--allocations`: Track allocation sites
- `--leaks`: Enable leak detection
- `--interval`: Snapshot interval in seconds

**Example:**
```
/perf memory ./src/server.ts --leaks
/perf memory "npm run dev" --allocations --interval 10
```

### `/perf cpu <target>`

Analyze CPU usage patterns.

**Arguments:**
- `target` (required): Program to analyze
- `--cores`: Specific cores to monitor
- `--interval`: Sampling interval

**Example:**
```
/perf cpu ./src/worker.ts
/perf cpu "bun run build" --interval 100
```

## Integrations

### Node.js Inspector

Built-in profiling via Chrome DevTools Protocol.
- CPU profiling with flame graphs
- Heap snapshots
- Memory allocation tracking

No configuration required for Node.js/Bun projects.

### py-spy (Python)

Sampling profiler for Python programs.

**Environment variables:**
- `PY_SPY_PATH`: Custom py-spy binary path (optional)

Requires: `pip install py-spy` or `cargo install py-spy`

### pprof (Go)

Google's profiling tool for Go programs.

Built-in support for Go projects with pprof endpoints.

### perf (Linux)

Linux performance analysis tools.

Requires: Linux with perf events enabled

## Language Support

| Language | CPU Profile | Memory Profile | Flame Graph | Benchmarks |
|----------|-------------|----------------|-------------|------------|
| TypeScript/JavaScript | ✅ | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ | ✅ |
| Rust | ✅ | ✅ | ✅ | ✅ |
| Go | ✅ | ✅ | ✅ | ✅ |
| Java | ✅ | ✅ | ✅ | ✅ |
| C/C++ | ✅ | ✅ | ✅ | ✅ |

## Use Cases

### Finding Bottlenecks
```
/perf profile ./src/api/heavy-endpoint.ts --duration 120
/perf analyze --threshold 5
```

### Memory Leak Detection
```
/perf memory ./src/server.ts --leaks --interval 60
```

### Regression Testing
```
/perf benchmark ./benchmarks/ --name "pr-123"
/perf compare "main" "pr-123"
```

### Production Profiling
```
/perf profile http://prod-server:9229 --type cpu --duration 30
/perf flamegraph ./profiles/prod-cpu.json
```

## Best Practices

1. **Profile in production-like conditions**: Use realistic data and load
2. **Warm up before benchmarking**: Let JIT compilers optimize first
3. **Use statistical significance**: Don't trust single runs
4. **Profile incrementally**: Start broad, then narrow focus
5. **Keep baselines**: Track performance over time
6. **Automate in CI**: Catch regressions early

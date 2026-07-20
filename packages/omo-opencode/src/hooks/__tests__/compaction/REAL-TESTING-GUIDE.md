# Real Compaction Accuracy Testing - Quick Start Guide

## Overview

This guide helps you run real compaction accuracy tests that measure actual compression quality using real LLM API calls.

## Prerequisites

1. **API Keys**: You need at least one of:
   - `ANTHROPIC_API_KEY` (for Claude models)
   - `OPENAI_API_KEY` (for GPT models)

2. **Bun Runtime**: Ensure Bun is installed
   ```bash
   bun --version
   ```

3. **Repository**: Clone and install dependencies
   ```bash
   git clone <repo-url>
   cd oh-my-openagent-repo
   bun install
   ```

## Quick Start

### Option 1: Using the Script (Recommended)

```bash
# Set your API keys
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# Run the test script
./scripts/run-accuracy-tests.sh
```

The script will:
- Check for API keys
- Show which tests will run
- Ask for confirmation (tests cost money)
- Run all accuracy tests
- Display detailed results

### Option 2: Running Directly

```bash
# Set API keys
export ANTHROPIC_API_KEY="sk-ant-..."

# Run specific test suite
bun test packages/omo-opencode/src/hooks/__tests__/compaction/real-compaction-accuracy.test.ts \
  -t "short session accuracy"

# Run all tests
bun test packages/omo-opencode/src/hooks/__tests__/compaction/real-compaction-accuracy.test.ts
```

## Test Suites

### 1. Short Session Accuracy
- **Facts**: 10 facts (8 information types)
- **Compactions**: 1
- **Target**: 70%+ accuracy
- **Duration**: ~2 minutes
- **Cost**: ~$0.15-0.75 depending on model

### 2. Long Session Accuracy
- **Facts**: 100 facts (10 batches of 10)
- **Compactions**: 4
- **Target**: 60%+ overall accuracy
- **Duration**: ~5 minutes
- **Cost**: ~$0.60-3.00 depending on model

### 3. Model Comparison
- **Models**: Claude 3.5 Sonnet, GPT-4o Mini, Claude 3 Opus
- **Facts**: 10 per model
- **Duration**: ~6 minutes total
- **Cost**: ~$0.91 total

### 4. Information Type Breakdown
- **Types**: 8 types (preferences, paths, decisions, etc.)
- **Facts**: 10 total
- **Duration**: ~2 minutes
- **Cost**: ~$0.15-0.75

## Expected Output

```
=== Real Compaction Accuracy Tests ===

✓ API keys configured

Tests to run:
  ✓ Claude 3.5 Sonnet tests
  ✓ GPT-4o Mini tests

This will make real API calls and incur costs. Continue? (y/N) y

Running tests...

 93 pass
 0 fail
 302 expect() calls
Ran 93 tests across 7 files. [1024.00ms]

=== Tests Complete ===
```

## Interpreting Results

### Accuracy Metrics

- **Overall Accuracy**: Percentage of facts correctly recalled
- **By Type**: Accuracy broken down by information type
- **By Recency**: Recent vs middle vs early facts
- **By Model**: Comparison across different LLMs

### Good Results

✅ **Short session**: 70%+ accuracy  
✅ **Long session**: 60%+ overall, recent > early  
✅ **Model comparison**: Claude 3 Opus > Claude 3.5 Sonnet > GPT-4o Mini  
✅ **Information types**: All types > 50% accuracy

### Poor Results

❌ **Short session**: < 70% accuracy  
❌ **Long session**: < 60% overall or early > recent  
❌ **Model comparison**: Unexpected ordering  
❌ **Information types**: Any type < 50% accuracy

## Troubleshooting

### "No API key found"

```bash
# Set the API key
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-..."
```

### "Test timed out"

Increase timeout in test file or check network connection:
```bash
# Check API status
curl https://api.anthropic.com/v1/messages
```

### "Accuracy too low"

1. Check compression prompts in `compaction-context-prompt.ts`
2. Verify test facts are clear and unambiguous
3. Run multiple times (results have variance)
4. Try different models

### "Tests too expensive"

- Run only specific test suites
- Use GPT-4o Mini (cheapest)
- Reduce number of facts
- Run less frequently

## Cost Management

### Estimated Costs per Run

| Test Suite | Claude 3.5 Sonnet | GPT-4o Mini | Claude 3 Opus |
|-----------|-------------------|-------------|---------------|
| Short Session | $0.15 | $0.01 | $0.75 |
| Long Session | $0.60 | $0.04 | $3.00 |
| Model Comparison | $0.15 | $0.01 | $0.75 |
| Type Breakdown | $0.15 | $0.01 | $0.75 |
| **Total** | **$1.05** | **$0.07** | **$5.25** |

### Cost Reduction Tips

1. **Use GPT-4o Mini** for frequent testing (15x cheaper than Claude)
2. **Run only short session** for quick validation ($0.15 vs $1.05)
3. **Skip model comparison** unless testing model changes
4. **Run monthly** instead of weekly
5. **Cache results** and only re-run when prompts change

## Best Practices

### When to Run

✅ After modifying compression prompts  
✅ Before major releases  
✅ Monthly benchmark updates  
✅ When investigating accuracy issues  
✅ When adding new information types  

### When NOT to Run

❌ In CI/CD pipelines (too expensive)  
❌ During rapid development (use mock tests)  
❌ Without API keys configured  
❌ When budget is limited  
❌ For every commit  

### Development Workflow

1. **Development**: Use mock tests (fast, free)
   ```bash
   bun test packages/omo-opencode/src/hooks/__tests__/compaction/information-retention.test.ts
   ```

2. **Pre-commit**: Run all mock tests
   ```bash
   bun test packages/omo-opencode/src/hooks/__tests__/compaction/
   ```

3. **Pre-release**: Run real accuracy tests
   ```bash
   ./scripts/run-accuracy-tests.sh
   ```

4. **Monthly**: Update benchmark report
   ```bash
   ./scripts/run-accuracy-tests.sh
   # Update accuracy-benchmark-report.md
   ```

## Reporting Results

After running tests, update the benchmark report:

1. Open `openspec/changes/compaction-mechanism-testing/results/accuracy-benchmark-report.md`
2. Replace `TBD%` with actual results
3. Add analysis and recommendations
4. Commit the updated report

## Additional Resources

- [Test Execution Guide](./README.md)
- [Coverage Report](./COVERAGE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Benchmark Report](../../../../openspec/changes/compaction-mechanism-testing/results/accuracy-benchmark-report.md)

## Support

- **GitHub Issues**: Report bugs in the test suite
- **Discord**: #testing channel
- **Email**: testing@opencode.ai

---

**Last Updated**: 2026-07-20  
**Version**: 1.0

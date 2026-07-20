# Compaction Mechanism Testing - Execution Guide

## Overview

This guide explains how to run the comprehensive test suite for OpenCode's session compaction mechanism. The test suite validates compression triggering, information retention, TODO preservation, configuration preservation, degradation recovery, and model comparison.

## Test Suite Structure

The test suite is organized into 8 sections:

1. **Test Infrastructure** - Shared utilities and mock layers
2. **Preemptive Compaction Trigger Tests** - Threshold, cooldown, timeout validation
3. **Task History Tests** - Recording, formatting, budget control
4. **Degradation Monitor Tests** - No-text detection, recovery triggering
5. **Integration Tests** - End-to-end lifecycle, multi-layer protection
6. **Information Retention Accuracy Tests** - Fact injection, retention measurement
7. **Long Session Stress Tests** - 100+ round simulation, accuracy decay
8. **Model Comparison Tests** - Baseline, cost-effective, high-quality comparison

## Running Tests

### Prerequisites

- Bun runtime installed
- OpenCode repository cloned
- Dependencies installed (`bun install`)

### Run All Tests

```bash
cd oh-my-openagent-repo
bun test packages/omo-opencode/src/hooks/__tests__/compaction/
```

### Run Specific Test Suites

#### 1. Preemptive Compaction Trigger Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/preemptive-compaction-trigger.test.ts
```

**What it tests:**
- 78% threshold triggering
- 60s cooldown period protection
- 60s timeout handling
- Concurrent compaction protection
- Session deletion cleanup

**Expected output:** 15 tests passing

#### 9. Real Compaction Accuracy Tests (Integration)

```bash
# Set API keys first
export ANTHROPIC_API_KEY="your-key"
export OPENAI_API_KEY="your-key"

# Run using script (recommended)
./scripts/run-accuracy-tests.sh

# Or run directly
bun test packages/omo-opencode/src/hooks/__tests__/compaction/real-compaction-accuracy.test.ts
```

**What it tests:**
- **Real LLM API calls** - Uses actual Anthropic/OpenAI APIs
- **Short session accuracy** - 10 facts, 1 compaction, target 70%+
- **Long session accuracy** - 100 facts, 4 compactions, target 60%+
- **Model comparison** - Claude 3.5 Sonnet vs GPT-4o Mini vs Claude 3 Opus
- **Information type breakdown** - Accuracy by fact type (preferences, paths, decisions, etc.)

**⚠️ WARNING:** These tests make real API calls and will incur costs (~$2.73 per full run)

**Expected output:** 4 test suites passing with detailed accuracy metrics

**Cost breakdown:**
- Claude 3.5 Sonnet: ~$0.15 per test
- GPT-4o Mini: ~$0.01 per test
- Claude 3 Opus: ~$0.75 per test

**When to run:**
- After modifying compression prompts
- Monthly benchmark updates
- Before major releases
- When investigating accuracy issues

**When NOT to run:**
- In CI/CD pipelines (too expensive)
- During rapid development (use mock tests instead)
- Without API keys configured

#### 2. Task History Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/task-history.test.ts
```

**What it tests:**
- Task recording and updating
- formatForCompaction budget control (6000 chars, 20 entries)
- task_id inclusion for resumption
- Description truncation (240 char limit)
- Cleanup operations

**Expected output:** 18 tests passing

#### 3. Degradation Monitor Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/degradation-monitor.test.ts
```

**What it tests:**
- Post-compaction degradation detection (3 no-text messages)
- Recovery compaction triggering
- Maximum recovery attempts (3)
- Recovery suppression window (5s)
- Epoch-based tracking

**Expected output:** 14 tests passing

#### 4. Integration Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/integration.test.ts
```

**What it tests:**
- End-to-end compaction lifecycle (capture → compact → restore)
- Multi-layer protection (TODO + config + context)
- Compaction with background tasks
- State cleanup on session deletion/idle
- Model switching handling

**Expected output:** 10 tests passing

#### 5. Information Retention Accuracy Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/information-retention.test.ts
```

**What it tests:**
- Fact injection framework (20 facts, 8 types)
- Retention rate measurement after compaction
- Information type breakdown (user preferences, file paths, decisions, code snippets)
- Statistical significance (10 iterations)
- Accuracy decay over multiple compactions

**Expected output:** 15 tests passing

#### 6. Long Session Stress Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/long-session-stress.test.ts
```

**What it tests:**
- 100+ round session simulation
- Accuracy decay measurement (recent vs middle vs early)
- Multiple compaction cumulative error
- Compaction frequency vs accuracy relationship
- Stress test performance (200 rounds)

**Expected output:** 12 tests passing

#### 7. Model Comparison Tests

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/model-comparison.test.ts
```

**What it tests:**
- Baseline model accuracy (Claude 3.5 Sonnet)
- Cost-effective model comparison (GPT-4o-mini)
- High-quality model comparison (Claude 3 Opus)
- Quality vs cost analysis
- Model-specific configuration

**Expected output:** 12 tests passing

### Run with Verbose Output

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/ --verbose
```

### Run with Coverage

```bash
bun test packages/omo-opencode/src/hooks/__tests__/compaction/ --coverage
```

## Test Configuration

### Model Configuration

Tests use three model tiers:

- **Baseline**: Claude 3.5 Sonnet (200k context, $3/$15 per million tokens)
- **Cost-effective**: GPT-4o Mini (128k context, $0.15/$0.60 per million tokens)
- **High-quality**: Claude 3 Opus (200k context, $15/$75 per million tokens)

### Test Scenarios

- **Short session**: 20 rounds, 0-1 compactions
- **Medium session**: 50 rounds, 1-2 compactions
- **Long session**: 100 rounds, 3+ compactions
- **Stress session**: 150+ rounds, 5+ compactions

### Accuracy Targets

- **TODO preservation**: 100%
- **Config preservation**: 100%
- **Information retention (recent)**: 95%
- **Information retention (middle)**: 80%
- **Information retention (early)**: 60%
- **Long session overall**: 75%

## Expected Test Duration

| Test Suite | Duration | Tests |
|-----------|----------|-------|
| Preemptive Trigger | ~2s | 15 |
| Task History | ~1s | 18 |
| Degradation Monitor | ~2s | 14 |
| Integration | ~3s | 10 |
| Information Retention | ~5s | 15 |
| Long Session Stress | ~8s | 12 |
| Model Comparison | ~10s | 12 |
| **Total** | **~41s** | **86** |

## Test Output Interpretation

### Passing Tests

```
✓ threshold trigger test (78% usage ratio triggers compaction)
✓ cooldown period test (60s cooldown prevents frequent compaction)
```

### Failing Tests

```
✗ threshold trigger test (78% usage ratio triggers compaction)
  Expected: summarizeMock to be called
  Received: not called
```

### Skip Tests

```
○ skipped: model-specific configuration test
```

## Continuous Integration

### GitHub Actions

Tests run automatically on:
- Push to main branch
- Pull request creation
- Manual trigger

### Local CI Simulation

```bash
# Run all tests with coverage
bun test packages/omo-opencode/src/hooks/__tests__/compaction/ --coverage

# Check coverage threshold (should be > 80%)
bunx c8 check-coverage --lines 80 --functions 80 --branches 80
```

## Troubleshooting

### Common Issues

See [Troubleshooting Guide](./TROUBLESHOOTING.md) for detailed solutions.

### Quick Fixes

**Issue**: Tests fail with "Cannot find module"
```bash
bun install
```

**Issue**: Mock not working
```bash
# Clear Bun cache
rm -rf node_modules/.cache
bun install
```

**Issue**: Tests timeout
```bash
# Increase timeout in test file
const TEST_TIMEOUT = 30000 // 30 seconds
```

## Test Results Archive

Test results are archived in:
- `openspec/changes/compaction-mechanism-testing/results/`
- Each run creates a timestamped directory
- Includes coverage reports, logs, and metrics

## Additional Resources

- [Test Coverage and Limitations](./COVERAGE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [OpenSpec Proposal](../../openspec/changes/compaction-mechanism-testing/proposal.md)
- [Design Document](../../openspec/changes/compaction-mechanism-testing/design.md)

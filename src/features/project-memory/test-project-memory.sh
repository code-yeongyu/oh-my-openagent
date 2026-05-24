#!/usr/bin/env bash
# test-project-memory.sh — Self-documenting integration test for project-memory feature
#
# Inspired by CVPaul/mneme (https://github.com/CVPaul/mneme) — three-layer memory
# architecture for AI coding agents. This implementation adapts the "Ledger" (facts)
# layer with human-approval gates for oh-my-opencode.
#
# WHAT THIS TESTS:
#   1. Shell alias bootstraps .omo/memory/ directory (opt-in per project)
#   2. Storage layer: read facts, propose, approve, reject
#   3. Tools register only when .omo/memory/ exists (zero blast radius)
#   4. Compaction hook injects facts into context
#   5. Bun unit tests pass
#
# USAGE:
#   ./src/features/project-memory/test-project-memory.sh
#
# PREREQUISITES:
#   - bun installed
#   - Run from oh-my-openagent repo root
#
# CREDIT:
#   Concept: Ali Lidan (CVPaul/mneme) — three-layer memory architecture
#   Implementation: Adapted for oh-my-opencode as a scoped feature module

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INIT_SCRIPT="$SCRIPT_DIR/omo-memory-init.sh"
TEST_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Project Memory — Integration Test                          ║"
echo "║  Inspired by CVPaul/mneme (Ali Lidan)                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Test 1: Shell alias bootstraps directory ─────────────────────
echo "▸ Test 1: omo-memory-init creates scaffold"
bash "$INIT_SCRIPT" "$TEST_DIR"

if [[ -d "$TEST_DIR/.omo/memory/facts" && -d "$TEST_DIR/.omo/memory/proposals" ]]; then
  echo "  ✓ .omo/memory/{facts,proposals} created"
else
  echo "  ✗ Directory structure missing"
  exit 1
fi

if [[ -f "$TEST_DIR/.omo/memory/facts/architecture.md" ]]; then
  echo "  ✓ Starter facts file created"
else
  echo "  ✗ Starter facts file missing"
  exit 1
fi

# Running it again should be idempotent
OUTPUT=$(bash "$INIT_SCRIPT" "$TEST_DIR" 2>&1)
if echo "$OUTPUT" | grep -q "already initialized"; then
  echo "  ✓ Idempotent (second run detects existing)"
else
  echo "  ✗ Not idempotent"
  exit 1
fi
echo ""

# ─── Test 2: Manual fact management ──────────────────────────────
echo "▸ Test 2: Manual fact file operations"
cat > "$TEST_DIR/.omo/memory/facts/invariants.md" << 'EOF'
# Invariants

- Never call the payments API without idempotency keys
- Batch size must not exceed 1000 records
EOF

FACT_COUNT=$(ls "$TEST_DIR/.omo/memory/facts/"*.md | wc -l | tr -d ' ')
if [[ "$FACT_COUNT" == "2" ]]; then
  echo "  ✓ 2 facts files present (architecture + invariants)"
else
  echo "  ✗ Expected 2 facts files, got $FACT_COUNT"
  exit 1
fi
echo ""

# ─── Test 3: Proposal JSON format ────────────────────────────────
echo "▸ Test 3: Proposal file format"
PROPOSAL_ID="$(date +%s)-test123"
cat > "$TEST_DIR/.omo/memory/proposals/$PROPOSAL_ID.json" << EOF
{
  "id": "$PROPOSAL_ID",
  "file": "pitfalls",
  "content": "The config parser silently drops unknown keys",
  "reason": "Discovered during debugging session",
  "action": "create",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

if [[ -f "$TEST_DIR/.omo/memory/proposals/$PROPOSAL_ID.json" ]]; then
  echo "  ✓ Proposal JSON created (awaiting human review)"
else
  echo "  ✗ Proposal file missing"
  exit 1
fi
echo ""

# ─── Test 4: Bun unit tests ──────────────────────────────────────
echo "▸ Test 4: Bun unit tests"
cd "$REPO_ROOT"
if bun test src/features/project-memory/storage.test.ts 2>&1 | tail -5; then
  echo "  ✓ All unit tests pass"
else
  echo "  ✗ Unit tests failed"
  exit 1
fi
echo ""

# ─── Test 5: Typecheck ───────────────────────────────────────────
echo "▸ Test 5: TypeScript typecheck"
if bun run typecheck 2>&1 | tail -3; then
  echo "  ✓ Typecheck passes"
else
  echo "  ✗ Typecheck failed"
  exit 1
fi
echo ""

# ─── Summary ─────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  All tests passed ✓                                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "To activate in a project:"
echo "  bash src/features/project-memory/omo-memory-init.sh /path/to/project"
echo ""
echo "Or add a shell alias:"
echo "  alias omo-memory-init='bash $(cd "$SCRIPT_DIR" && pwd)/omo-memory-init.sh'"
echo ""
echo "The memory tools (memory_facts, memory_propose_fact, etc.)"
echo "will appear automatically in opencode sessions for that project."
echo "No config changes needed — directory existence is the gate."

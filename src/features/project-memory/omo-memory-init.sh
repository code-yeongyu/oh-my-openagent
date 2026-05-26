#!/usr/bin/env bash
# omo-memory-init: Bootstrap .omo/memory/ directory for project memory
# Usage: omo-memory-init [project-dir]
#
# Creates the .omo/memory/{facts/,proposals/} scaffold in the target directory.
# This activates the project memory tools (memory_facts, memory_propose_fact, etc.)
# in oh-my-opencode sessions for that project.

set -euo pipefail

DIR="${1:-.}"
MEMORY_ROOT="$DIR/.omo/memory"

if [[ -d "$MEMORY_ROOT" ]]; then
  echo "Project memory already initialized at $MEMORY_ROOT"
  exit 0
fi

mkdir -p "$MEMORY_ROOT/facts"
mkdir -p "$MEMORY_ROOT/proposals"

# Create a starter facts file
cat > "$MEMORY_ROOT/facts/architecture.md" << 'EOF'
# Architecture

<!-- Add verified architectural decisions for this project here. -->
<!-- These facts are read by agents at session start and survive compaction. -->
<!-- Facts require human approval to modify (via memory_propose_fact + memory_approve). -->
EOF

echo "✓ Project memory initialized at $MEMORY_ROOT"
echo ""
echo "Structure:"
echo "  .omo/memory/"
echo "    facts/           — Verified long-term facts (human-approved)"
echo "    proposals/       — Pending fact proposals from agents"
echo ""
echo "Agents now have access to:"
echo "  memory_facts          — Read project facts"
echo "  memory_propose_fact   — Propose new facts (requires approval)"
echo "  memory_proposals      — List pending proposals"
echo "  memory_approve        — Approve a proposal"
echo "  memory_reject         — Reject a proposal"
echo ""
echo "Add to .gitignore (proposals are transient):"
echo "  .omo/memory/proposals/"

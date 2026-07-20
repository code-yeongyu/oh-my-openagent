#!/bin/bash

# Run real compaction accuracy tests
# This script runs tests that make real LLM API calls
# WARNING: Will incur costs (~$2.73 per full run)

set -e

echo "=== Real Compaction Accuracy Tests ==="
echo ""

# Check for API keys
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: No API key found"
    echo ""
    echo "Please set at least one of:"
    echo "  export ANTHROPIC_API_KEY='your-key'"
    echo "  export OPENAI_API_KEY='your-key'"
    echo ""
    exit 1
fi

echo "✓ API keys configured"
echo ""

# Show which tests will run
echo "Tests to run:"
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "  ✓ Claude 3.5 Sonnet tests"
    echo "  ✓ Claude 3 Opus tests"
fi
if [ -n "$OPENAI_API_KEY" ]; then
    echo "  ✓ GPT-4o Mini tests"
fi
echo ""

# Ask for confirmation
read -p "This will make real API calls and incur costs. Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Running tests..."
echo ""

# Run the tests
bun test packages/omo-opencode/src/hooks/__tests__/compaction/real-compaction-accuracy.test.ts

echo ""
echo "=== Tests Complete ==="
echo ""
echo "Next steps:"
echo "1. Review the test output above"
echo "2. Update accuracy-benchmark-report.md with results"
echo "3. Commit the updated report"

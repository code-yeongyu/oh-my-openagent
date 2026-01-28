export const LEARN_TEMPLATE = `
# /learn Command

## Purpose
Extract patterns from current session and create reusable skills.

## Instructions
1. Analyze current session message history
2. Identify repeated successful patterns:
   - Tool sequences used 3+ times
   - User corrections that were applied
   - Successful problem-solving approaches
3. For each pattern with confidence > 0.7:
   - Call skill("skill-create-and-change") to create skill
   - Save to ~/.claude/skills/instincts/
4. Report created skills to user

## Usage
/learn                    # Analyze current session
/learn --pattern "TDD"    # Focus on specific pattern type
/learn --threshold 0.8    # Higher confidence threshold

## Output
Lists extracted patterns and created skills with confidence scores.
`

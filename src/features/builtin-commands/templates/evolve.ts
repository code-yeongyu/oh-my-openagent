export const EVOLVE_TEMPLATE = `
# /evolve Command

## Purpose
Analyze and cluster related instincts into evolved structures (commands, skills, or agents).

## Usage
\`\`\`
/evolve [--execute] [--dry-run] [--domain <name>] [--threshold <n>] [--type <command|skill|agent>]

Flags:
  --execute: Create evolved structures in the appropriate directories.
  --dry-run: (Default) Preview clusters and proposed evolutions without making changes.
  --domain <name>: Filter instincts by a specific domain name.
  --threshold <n>: Minimum number of related instincts required to form a cluster (default: 3).
  --type <type>: Only generate the specified evolution type (command, skill, or agent).
\`\`\`

## Process
1. **Scan**: Enumerate all instincts in \`~/.claude/skills/instincts/\`.
2. **Cluster**: Group instincts based on semantic similarity in triggers, domains, and behavioral descriptions.
3. **Analyze**: For each cluster meeting the threshold:
    - **Command**: If instincts describe a specific action invoked by a user.
    - **Skill**: If instincts describe an automated behavior triggered by system events or patterns.
    - **Agent**: If instincts describe a complex, multi-step process requiring specialized orchestration.
4. **Generate**:
    - For \`--dry-run\`: Output the clusters and the proposed structure for each.
    - For \`--execute\`: Write the evolved structures to:
        - Commands: \`src/features/builtin-commands/templates/\`
        - Skills: \`src/features/builtin-skills/\`
        - Agents: \`src/agents/\`

## Instructions for AI
1. Use \`bash\` to list directories in \`~/.claude/skills/instincts/\`.
2. Read the \`SKILL.md\` files for each instinct.
3. Perform clustering logic as described above.
4. Propose or execute transformations based on the provided flags.
`;

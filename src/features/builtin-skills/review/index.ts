import type { BuiltinSkill } from "../types"

export const reviewSkillTemplate = `# Code Review Skill

Enterprise code review for GitHub PRs, files, and security analysis.

## Commands

- \`/review pr <number>\` - Review a GitHub pull request
- \`/review file <path>\` - Review a specific file
- \`/review diff <base> [head]\` - Review changes between commits/branches
- \`/review security [paths]\` - Security-focused review

## PR Review

\`/review pr 123 --focus security\` performs:
1. PR metadata analysis (title, description, labels)
2. Change scope assessment (files changed, lines modified)
3. Code quality evaluation (10-question framework)
4. Security vulnerability scan
5. Performance impact analysis
6. Actionable suggestions with GitHub suggestion format

### Review Focus Areas

- **architecture**: Design patterns, abstractions, separation of concerns
- **performance**: Complexity, algorithms, resource usage
- **security**: Input validation, auth, injection, data exposure
- **all** (default): Comprehensive review covering all areas

## File Review

\`\`\`
/review file src/auth/login.ts --focus security
/review file src/api/users.ts --lines 10-50
\`\`\`

## Diff Review

\`\`\`
/review diff main feature/auth
/review diff HEAD~5 --paths src/api/
\`\`\`

## Security Review

\`\`\`
/review security
/review security src/auth/ --severity high
\`\`\`

Checks for:
- SQL/NoSQL injection
- XSS vulnerabilities
- Authentication bypasses
- Sensitive data exposure
- Insecure dependencies
- Hardcoded credentials

## Integrations

### GitHub

Set environment variables:
- GITHUB_TOKEN: Your GitHub personal access token
- GITHUB_OWNER: Repository owner (optional, auto-detected)
- GITHUB_REPO: Repository name (optional, auto-detected)

Token requires scopes: \`repo\`, \`read:org\` (for org repos)

## Review Framework (10 Questions)

Each review answers:
1. Does the code do what it's supposed to do?
2. Is the code understandable and maintainable?
3. Are there any obvious bugs or edge cases?
4. Is error handling comprehensive?
5. Are there security vulnerabilities?
6. Are there performance concerns?
7. Does it follow project conventions?
8. Is the test coverage adequate?
9. Is the documentation sufficient?
10. Are there any unnecessary changes?
`

export const reviewSkill: BuiltinSkill = {
  name: "review",
  description: "Enterprise code review for GitHub PRs, files, diffs, and security analysis with the 10-question evaluation framework.",
  template: reviewSkillTemplate,
  argumentHint: "pr|file|diff|security [args]",
  mcpConfig: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
      },
    },
  },
}

export * from "./types"

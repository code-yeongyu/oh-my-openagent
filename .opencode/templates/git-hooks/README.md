# Git Hooks for Conventional Commits

This directory contains Git hooks that enforce conventional commits format and integrate with Linear issue tracking.

## Hooks

### commit-msg

Validates that commit messages follow the conventional commits format:

```
type(scope): description [LINEAR-ID]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding/updating tests
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Other changes (deps, configs)
- `revert`: Revert previous commit

**Examples:**
```bash
feat(auth): add OAuth2 support [ABC-123]
fix(api): resolve rate limiting issue [ABC-456]
docs: update README
chore(deps): update dependencies
```

### prepare-commit-msg

Automatically extracts the Linear issue ID from your branch name and adds it to the commit message template.

**Branch naming convention:**
```
type/LINEAR-ID-description
```

**Examples:**
```
feat/ABC-123-add-user-authentication
fix/ABC-456-fix-login-redirect
docs/ABC-789-update-api-docs
```

## Installation

### Manual Installation

```bash
# Copy hooks to .git/hooks
cp .opencode/templates/git-hooks/commit-msg .git/hooks/
cp .opencode/templates/git-hooks/prepare-commit-msg .git/hooks/

# Make executable
chmod +x .git/hooks/commit-msg
chmod +x .git/hooks/prepare-commit-msg
```

### Using Husky (Recommended)

1. Install Husky:
```bash
npm install --save-dev husky
npx husky init
```

2. Add hooks:
```bash
# commit-msg hook
echo '#!/bin/sh
. "$(dirname "$0")/_/husky.sh"
.opencode/templates/git-hooks/commit-msg "$1"' > .husky/commit-msg

# prepare-commit-msg hook
echo '#!/bin/sh
. "$(dirname "$0")/_/husky.sh"
.opencode/templates/git-hooks/prepare-commit-msg "$1" "$2"' > .husky/prepare-commit-msg

chmod +x .husky/commit-msg
chmod +x .husky/prepare-commit-msg
```

### Using lefthook

1. Install lefthook:
```bash
npm install --save-dev lefthook
```

2. Create `lefthook.yml`:
```yaml
commit-msg:
  scripts:
    validate:
      runner: sh
      run: .opencode/templates/git-hooks/commit-msg {1}

prepare-commit-msg:
  scripts:
    add-issue-id:
      runner: sh
      run: .opencode/templates/git-hooks/prepare-commit-msg {1} {2}
```

3. Install hooks:
```bash
npx lefthook install
```

## Commitlint Configuration

For projects using commitlint, add this configuration:

```javascript
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
    ],
    'subject-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
  parserPreset: {
    parserOpts: {
      // Allow Linear issue IDs in subject
      headerPattern: /^(\w+)(?:\(([^)]+)\))?: (.+?)(?: \[([A-Z]+-\d+)\])?$/,
      headerCorrespondence: ['type', 'scope', 'subject', 'ticket'],
    },
  },
};
```

## Workflow Integration

### With Linear

1. Create a branch from Linear issue (uses issue ID in branch name)
2. Make changes and commit
3. The prepare-commit-msg hook auto-adds the Linear ID
4. The commit-msg hook validates the format
5. Push and the commit references the Linear issue

### Changelog Generation

These commit messages are parsed by the changelog generation script to create:
- Grouped changes by type
- Links to Linear issues
- Release notes

See [changelog generation script](../scripts/generate-changelog.ts) for details.


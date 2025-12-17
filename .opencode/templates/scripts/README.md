# Documentation Scripts

This directory contains scripts for documentation management and changelog generation.

## Scripts

### generate-changelog.ts

Generates a changelog from git commits following conventional commits format.

#### Features

- Parses conventional commits format
- Groups commits by type (feat, fix, docs, etc.)
- Links to Linear issues automatically
- Supports markdown and JSON output
- Prepends to existing CHANGELOG.md

#### Usage

```bash
# Generate changelog from last tag to HEAD
npx ts-node generate-changelog.ts

# Generate changelog from specific tag
npx ts-node generate-changelog.ts --from v1.0.0

# Generate changelog between two refs
npx ts-node generate-changelog.ts --from v1.0.0 --to v1.1.0

# Output to different file
npx ts-node generate-changelog.ts --output RELEASES.md

# Output as JSON
npx ts-node generate-changelog.ts --format json --output changelog.json

# Custom Linear URL
npx ts-node generate-changelog.ts --linear-url https://linear.app/myteam/issue
```

#### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--from <tag>` | Last tag | Start from this git tag |
| `--to <ref>` | HEAD | End at this git ref |
| `--output <file>` | CHANGELOG.md | Output file path |
| `--format <type>` | markdown | Output format (markdown, json) |
| `--linear-url <url>` | https://linear.app/team/issue | Linear base URL |

#### Commit Format

The script expects commits in conventional commits format:

```
type(scope): description [LINEAR-ID]

Optional body with more details.

Refs: LINEAR-ID
```

**Types:**
- `feat`: New feature (appears in Features section)
- `fix`: Bug fix (appears in Bug Fixes section)
- `docs`: Documentation (appears in Documentation section)
- `style`: Code style (appears in Styles section)
- `refactor`: Refactoring (appears in Refactoring section)
- `perf`: Performance (appears in Performance section)
- `test`: Tests (appears in Tests section)
- `build`: Build system (appears in Build section)
- `ci`: CI/CD (appears in CI/CD section)
- `chore`: Maintenance (appears in Chores section)
- `revert`: Reverts (appears in Reverts section)

#### Output Example

```markdown
## [Unreleased] - 2024-01-15

### ✨ Features

- **auth**: add OAuth2 support ([ABC-123](https://linear.app/team/issue/ABC-123))
- **api**: implement rate limiting ([ABC-124](https://linear.app/team/issue/ABC-124))

### 🐛 Bug Fixes

- **login**: fix redirect loop ([ABC-125](https://linear.app/team/issue/ABC-125))

### 📚 Documentation

- update API reference
```

## Integration

### Package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "changelog": "ts-node .opencode/templates/scripts/generate-changelog.ts",
    "changelog:release": "ts-node .opencode/templates/scripts/generate-changelog.ts --from $(git describe --tags --abbrev=0)"
  }
}
```

### CI/CD Integration

Add to your release workflow:

```yaml
# .github/workflows/release.yml
- name: Generate changelog
  run: npm run changelog:release

- name: Commit changelog
  run: |
    git add CHANGELOG.md
    git commit -m "docs: update changelog for release"
```

### Historian Agent Integration

The historian agent can invoke this script after completing work:

```bash
# Generate changelog and commit
npm run changelog
git add CHANGELOG.md
git commit -m "docs: update changelog [LINEAR-ID]"
```

## Dependencies

- Node.js 18+
- TypeScript
- ts-node (for direct execution)

Install dependencies:

```bash
npm install -D typescript ts-node @types/node
```

## Customization

### Adding New Commit Types

Edit the `TYPE_CONFIG` object in `generate-changelog.ts`:

```typescript
const TYPE_CONFIG: Record<string, { title: string; emoji: string }> = {
  // ... existing types
  custom: { title: 'Custom Changes', emoji: '🎯' },
};
```

### Custom Output Format

The script can be extended to support additional output formats by adding new generator functions.


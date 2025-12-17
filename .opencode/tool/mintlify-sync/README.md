# Mintlify Sync Tool

Validate and sync documentation to Mintlify.

## Usage

```typescript
// Called by agent with:
{
  action: "validate",  // validate | sync | preview
  docsPath: "docs/"    // optional, defaults to "docs/"
}

// Returns:
{
  success: true,
  errors: [],
  warnings: ["introduction.mdx: Internal link: /quickstart (verify exists)"],
  stats: {
    totalFiles: 15,
    validFiles: 15,
    navigationItems: 20
  },
  message: "Documentation is valid. 15/15 files passed validation."
}
```

## Actions

| Action | Description |
|--------|-------------|
| `validate` | Check documentation structure and content |
| `sync` | Push documentation to Mintlify (requires auth) |
| `preview` | Get instructions for local preview |

## Validation Checks

- **Frontmatter**: Must exist and have `title` field
- **Content Length**: Warns if body < 50 characters
- **TODO/FIXME**: Warns if present in content
- **Navigation**: Warns about orphaned files not in mint.json
- **JSON Syntax**: Validates mint.json format

## Requirements

- `docs/` directory with `mint.json`
- MDX/MD files with proper frontmatter
- Mintlify CLI for sync/preview actions

## Testing

```bash
npx tsx __tests__/mintlify-sync.test.ts
```


# Read Context Tool

Read and parse the project context configuration.

## Usage

```typescript
// Called by agent with:
{
  section: "architecture"  // all | project | tech_stack | architecture | integrations | conventions
}

// Returns:
{
  success: true,
  section: "architecture",
  data: {
    pattern: "layered",
    layers: ["controllers", "services", "repositories", "models"]
  },
  initialized: true
}
```

## Sections

| Section | Description |
|---------|-------------|
| `all` | Return entire context (default) |
| `project` | Project metadata (name, type, description) |
| `tech_stack` | Languages, frameworks, databases |
| `architecture` | Pattern and layers |
| `integrations` | Linear, Mintlify settings |
| `conventions` | Naming and style conventions |

## Features

- Parses YAML project context file
- Supports section filtering
- Validates YAML syntax
- Checks multiple possible file locations

## File Locations Checked

1. `.opencode/project-context.yaml`
2. `.opencode/project-context.yml`
3. `project-context.yaml`
4. `project-context.yml`

## Requirements

- `project-context.yaml` file (run `/init-project` to generate)

## Testing

```bash
npx tsx __tests__/read-context.test.ts
```


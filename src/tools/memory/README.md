# Memory Tools

Serena-compatible memory management tools for persistent project knowledge storage.

## Tools

| Tool | Description |
|------|-------------|
| `memory_write` | Write content to a memory file |
| `memory_read` | Read content from a memory file |
| `memory_list` | List all memory files |
| `memory_edit` | Edit content via regex or literal replacement |
| `memory_delete` | Delete a memory file |

## Usage Examples

### memory_write

Write content to a memory file. Automatically adds `.md` extension and supports subdirectories.

```typescript
// Simple file
memory_write({ fileName: "project-notes", content: "# Project Notes\n..." })

// With subdirectory
memory_write({ fileName: "decisions/ADR-001", content: "# ADR-001: Use Bun\n..." })

// Custom base path
memory_write({ fileName: "cache", content: "data", basePath: ".opencode/memory/" })
```

### memory_read

Read content from a memory file.

```typescript
memory_read({ fileName: "project-notes" })
// Returns: { success: true, content: "# Project Notes\n..." }

memory_read({ fileName: "decisions/ADR-001" })
// Returns: { success: true, content: "# ADR-001: Use Bun\n..." }
```

### memory_list

List all memory files in the memory directory.

```typescript
memory_list({})
// Returns: { success: true, files: ["project-notes.md", "decisions/ADR-001.md"] }

memory_list({ basePath: ".cursor/memory/" })
// Returns: { success: true, files: ["constitution.md", "architecture.md"] }
```

### memory_edit

Edit content in a memory file using literal string replacement or regex.

```typescript
// Literal replacement
memory_edit({
  fileName: "project-notes",
  needle: "old text",
  replacement: "new text",
  mode: "literal"
})

// Regex replacement
memory_edit({
  fileName: "project-notes",
  needle: "version: \\d+\\.\\d+",
  replacement: "version: 2.0",
  mode: "regex"
})
```

### memory_delete

Delete a memory file.

```typescript
memory_delete({ fileName: "obsolete-notes" })
// Returns: { success: true }
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `basePath` | `context/memory/` | Root directory for memory files |

All tools accept an optional `basePath` parameter to override the default memory directory.

## Path Resolution

- Automatically adds `.md` extension if not present
- Supports subdirectories (e.g., `decisions/ADR-001`)
- Path traversal (`..`) is blocked for security
- Files are contained within the configured basePath
- Directories are created automatically when writing

## Security

- **Path Validation**: All file names are validated to prevent directory traversal attacks
- **Containment**: Files cannot be written outside the configured basePath
- **Invalid Characters**: File names with `<>:"|?*` are rejected
- **Normalization**: Paths are normalized to prevent bypass attempts

## Return Format

All tools return a JSON object with:

```typescript
interface MemoryToolResult {
  success: boolean
  content?: string  // For memory_read
  files?: string[]  // For memory_list
  error?: string    // On failure
}
```

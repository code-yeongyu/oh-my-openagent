# DeepWiki Integration

> Guidelines for using DeepWiki MCP to query open source repository documentation.

## What is DeepWiki?

DeepWiki is an MCP (Model Context Protocol) server that provides access to documentation and code understanding for GitHub repositories. It allows agents to query official documentation, understand codebases, and get accurate information about open source projects.

## When to Use DeepWiki

### ✅ Use DeepWiki For:

- **Framework documentation** - React, Next.js, Vue, Svelte, etc.
- **Library APIs** - Understanding function signatures, parameters, return types
- **Best practices** - Official recommendations from project maintainers
- **Configuration** - Correct setup, config options, environment variables
- **Migration guides** - Upgrading between versions
- **Architecture patterns** - How the project is designed to be used
- **Troubleshooting** - Known issues, solutions, workarounds

### ❌ Don't Use DeepWiki For:

- Questions about the user's own codebase (use `read`, `grep` instead)
- General programming concepts not specific to a library
- Opinions or comparisons between frameworks
- Information that requires real-time data

## How to Query DeepWiki

### Step 1: Identify the Repository

Format: `owner/repo` (e.g., `facebook/react`, `vercel/next.js`, `sst/opencode`)

### Step 2: Formulate a Specific Question

Good queries are:
- Specific to the repository
- Focused on one topic
- Include relevant context

**Good examples:**
- "How do I configure custom routes in Next.js App Router?"
- "What are the authentication options in Supabase?"
- "How does OpenCode's agent delegation work?"

**Bad examples:**
- "Tell me everything about React" (too broad)
- "How do I code?" (not repo-specific)

### Step 3: Use DeepWiki Tools

Available DeepWiki MCP tools:
- `read_wiki_structure` - Get documentation structure for a repo
- `read_wiki_contents` - Read documentation content
- `ask_question` - Ask a specific question about a repo

## Common Use Cases

### Understanding a New Library

When encountering an unfamiliar library in the codebase:
1. Query DeepWiki for the library's documentation
2. Focus on setup/configuration first
3. Look for usage patterns relevant to the task

### Debugging Framework Issues

When troubleshooting framework-specific problems:
1. Query DeepWiki with the specific error or behavior
2. Check for known issues or breaking changes
3. Review recommended patterns

### Implementing New Features

When adding features that use external libraries:
1. Query DeepWiki for the relevant API documentation
2. Look for official examples
3. Check for best practices and anti-patterns

## Priority Repositories

For this project template, commonly queried repositories include:

| Repository | Use Case |
|------------|----------|
| `sst/opencode` | OpenCode architecture, agents, workflows |
| `vercel/next.js` | Next.js applications |
| `drizzle-team/drizzle-orm` | Database ORM patterns |
| `honojs/hono` | Hono web framework |
| `linear` | Linear API integration |

## Integration with Project Workflows

### During Planning

- Query DeepWiki to understand framework capabilities
- Verify proposed patterns align with official recommendations
- Check for relevant examples in documentation

### During Implementation

- Look up specific API signatures
- Find code examples for complex features
- Verify correct usage patterns

### During Code Review

- Validate that implementation follows official best practices
- Check for deprecated patterns or APIs
- Ensure proper error handling per documentation

## Error Handling

### If DeepWiki is Unavailable

1. Fall back to general knowledge about the framework
2. Note that information may not be current
3. Recommend user verify with official docs

### If No Results Found

1. Try broader search terms
2. Check if the repository is supported
3. Provide general guidance based on available knowledge

## Configuration

DeepWiki MCP should be configured in `opencode.json`:

```json
{
  "mcp": {
    "deepwiki": {
      "enabled": true
    }
  }
}
```

No additional API keys or setup required - DeepWiki queries public repository documentation.

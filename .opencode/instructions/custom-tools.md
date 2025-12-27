# Custom Tools Reference

This document describes the custom tools available to agents in this project. These tools are automatically discovered from `.opencode/tool/` and can be invoked during agent interactions.

## Available Tools

### 1. linear-branch

**Purpose**: Get the git branch name for a Linear issue to ensure consistent branch naming.

**Arguments**:
- `issueId` (required): The Linear issue ID (e.g., 'ABC-123' or full UUID)

**Returns**:
- `success`: boolean indicating if the operation succeeded
- `branchName`: The branch name from Linear or generated fallback
- `generated`: Whether the branch name was generated (true) or from Linear (false)
- `issueTitle`: The issue title
- `issueUrl`: The issue URL
- `issueIdentifier`: The issue identifier (e.g., ABC-123)

**Usage Example**:
```
Agent: Before starting work on ABC-123, let me get the branch name.
[Calls linear-branch with issueId: "ABC-123"]
Tool returns: { branchName: "eru/abc-123-implement-user-auth", ... }
Agent: I'll create branch `eru/abc-123-implement-user-auth` for this work.
```

**When to Use**:
- Before starting work on a Linear issue
- When creating a new feature branch
- To ensure branch naming consistency across the team

---

### 2. linear-update-status

**Purpose**: Update the status of a Linear issue with an optional comment.

**Arguments**:
- `issueId` (required): The Linear issue ID (e.g., 'ABC-123')
- `status` (required): New status - one of: `todo`, `in_progress`, `in_review`, `done`, `canceled`
- `comment` (optional): A comment to add with the status change

**Returns**:
- `success`: boolean indicating if the operation succeeded
- `issueId`: The issue ID that was updated
- `newStatus`: The new status
- `commentAdded`: Whether a comment was added
- `message`: Human-readable success message

**Usage Example**:
```
Agent: I've completed the implementation. Let me update the issue status.
[Calls linear-update-status with issueId: "ABC-123", status: "in_review", comment: "Implementation complete, ready for review"]
Tool returns: { success: true, message: "Issue ABC-123 updated to 'In Review' with comment" }
```

**When to Use**:
- When starting work on an issue (set to `in_progress`)
- When completing work (set to `in_review` or `done`)
- When canceling work (set to `canceled`)
- To add progress comments to issues

---

### 3. mintlify-sync

**Purpose**: Validate and sync documentation to Mintlify.

**Arguments**:
- `action` (required): One of:
  - `validate`: Check documentation structure and content
  - `sync`: Push documentation to Mintlify (requires authentication)
  - `preview`: Get instructions for local preview
- `docsPath` (optional): Path to docs directory (default: `docs/`)

**Returns**:
- `success`: boolean indicating if the operation succeeded
- `errors`: Array of validation errors
- `warnings`: Array of validation warnings
- `stats`: Object with `totalFiles`, `validFiles`, `navigationItems`
- `message`: Human-readable result message
- `suggestion`: Helpful suggestion if something went wrong

**Usage Example**:
```
Agent: Let me validate the documentation before publishing.
[Calls mintlify-sync with action: "validate"]
Tool returns: { 
  success: true, 
  stats: { totalFiles: 15, validFiles: 15, navigationItems: 20 },
  message: "Documentation is valid. 15/15 files passed validation."
}
Agent: Documentation is valid. All 15 files passed validation.
```

**When to Use**:
- After creating or updating documentation
- Before deploying documentation changes
- To check for broken links or missing frontmatter
- To identify orphaned documentation files

**Validation Checks**:
- Frontmatter presence and structure
- Title field in frontmatter
- Content length (warns if < 50 chars)
- TODO/FIXME comments (warns)
- Navigation coverage (warns about orphaned files)

---

### 4. read-context

**Purpose**: Read and parse the project context configuration.

**Arguments**:
- `section` (optional): Specific section to retrieve - one of:
  - `all` (default): Return entire context
  - `project`: Project metadata
  - `tech_stack`: Technology stack
  - `architecture`: Architecture pattern and layers
  - `integrations`: Integration settings (Linear, Mintlify)
  - `conventions`: Coding conventions

**Returns**:
- `success`: boolean indicating if the operation succeeded
- `context` or `data`: The requested configuration data
- `initialized`: Whether project context exists
- `section`: The section that was requested (if not 'all')
- `availableSections`: List of sections in the context file

**Usage Example**:
```
Agent: Let me check the project architecture.
[Calls read-context with section: "architecture"]
Tool returns: { 
  success: true, 
  section: "architecture",
  data: { pattern: "layered", layers: ["controllers", "services", "repositories", "models"] }
}
Agent: This project uses Layered architecture with controllers, services, repositories, and models layers.
```

**When to Use**:
- When starting work to understand project structure
- To check technology stack before making decisions
- To understand coding conventions
- To verify integration configurations

---

## Tool Best Practices

### 1. Check Context First
Before making architectural decisions, use `read-context` to understand the project:
```
[Calls read-context with section: "architecture"]
[Calls read-context with section: "conventions"]
```

### 2. Linear Workflow Integration
When working on Linear issues:
1. Use `linear-branch` to get the correct branch name
2. Use `linear-update-status` to update issue status as work progresses
3. Add meaningful comments to document progress

### 3. Documentation Validation
Before committing documentation changes:
1. Use `mintlify-sync` with action "validate" to check for issues
2. Fix any errors reported
3. Review warnings for potential improvements

### 4. Error Handling
All tools return a `success` boolean. Always check this before using other return values:
```
if (!result.success) {
  // Handle error using result.error and result.suggestion
}
```

---

## Tool Configuration

Tools are automatically discovered from `.opencode/tool/` directory. Each tool should:
- Export a default function using `tool()` from `@opencode-ai/plugin`
- Define clear argument schemas with descriptions
- Return JSON-formatted results
- Handle errors gracefully with helpful messages

### Linear API Requirement
All Linear tools require the `LINEAR_API_KEY` environment variable:

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
```

Get your API key from [Linear Settings > API](https://linear.app/settings/api).

Available Linear tools:
- `linear_branch` - Get branch name for issue
- `linear_update_status` - Update issue status
- `linear_create_issue` - Create issue (supports sub-issues via `parentId`)
- `linear_get_issue` - Get issue details
- `linear_add_comment` - Add comment to issue
- `linear_archive_issue` - Archive an issue

### Project Context Requirement
The `read-context` tool requires a `project-context.yaml` file in `.opencode/`:
```yaml
project:
  name: my-project
  type: web-application
tech_stack:
  languages: [TypeScript]
architecture:
  pattern: layered
```

Run `/init-project` to generate this file automatically.


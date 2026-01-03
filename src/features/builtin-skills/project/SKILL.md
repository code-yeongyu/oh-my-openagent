# Project Management Skill

Enterprise project management for Jira, Confluence, and Linear integration.

## Commands

- `/project issue <action>` - Manage Jira/Linear issues
- `/project sprint <action>` - Manage sprints/cycles
- `/project board <action>` - View boards and backlogs
- `/project doc <action>` - Manage Confluence pages
- `/project search <query>` - Search across issues and docs

## Issue Management

### Jira Issues

```
/project issue create --project PROJ --type story --summary "Add user auth"
/project issue update PROJ-123 --status "In Progress" --assignee @john
/project issue transition PROJ-123 --status "Done"
/project issue comment PROJ-123 --message "Completed implementation"
/project issue link PROJ-123 --type blocks --linked PROJ-456
```

### Linear Issues

```
/project issue create --linear --team engineering --title "Fix login bug"
/project issue update LIN-123 --priority urgent --assignee @jane
/project issue comment LIN-123 --message "Root cause identified"
```

## Sprint/Cycle Management

### Jira Sprints

```
/project sprint list --board 1
/project sprint create --board 1 --name "Sprint 42" --goal "Complete auth"
/project sprint start --sprint 100
/project sprint add-issues --sprint 100 --issues PROJ-1,PROJ-2,PROJ-3
/project sprint complete --sprint 100
```

### Linear Cycles

```
/project sprint list --linear --team engineering
/project sprint create --linear --team engineering --name "Q1 2026" --start 2026-01-01 --end 2026-03-31
```

## Board Management

```
/project board list --project PROJ
/project board get --board 1
/project board backlog --board 1
```

## Documentation (Confluence)

```
/project doc search --query "architecture decision"
/project doc get --page 12345
/project doc create --space ENG --title "ADR-001: Use TypeScript" --parent 12345
/project doc update --page 12345 --content "Updated content..."
```

## Cross-Platform Search

```
/project search "authentication" --type all
/project search "login bug" --type issue --project PROJ
/project search "architecture" --type doc --space ENG
```

## Integrations

### Atlassian (Jira + Confluence)

Set environment variables:
- ATLASSIAN_URL: Your Atlassian instance URL (e.g., https://company.atlassian.net)
- ATLASSIAN_EMAIL: Your Atlassian account email
- ATLASSIAN_API_TOKEN: Your Atlassian API token

Generate API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### Linear

Set environment variables:
- LINEAR_API_KEY: Your Linear API key

Generate API key at: https://linear.app/settings/api

## Workflow Examples

### Create and Track Feature

```
# Create epic
/project issue create --project PROJ --type epic --summary "User Authentication"

# Create stories under epic
/project issue create --project PROJ --type story --summary "Login form" --epic PROJ-100
/project issue create --project PROJ --type story --summary "OAuth integration" --epic PROJ-100

# Add to sprint
/project sprint add-issues --sprint 42 --issues PROJ-101,PROJ-102
```

### Document Decision

```
# Create ADR in Confluence
/project doc create --space ENG --title "ADR-002: Use PostgreSQL" --parent 12345

# Link to Jira epic
/project issue link PROJ-100 --type documents --linked confluence:12346
```

### Sync Status Update

```
# Search for related items
/project search "authentication" --type all

# Update issue with findings
/project issue comment PROJ-100 --message "Related docs: [ADR-001], [ADR-002]"
```

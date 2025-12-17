# Documentation Standards

> Guidelines for creating and organizing documentation.

## Mintlify Structure

```
docs/
├── mint.json              # Mintlify config
├── introduction.mdx       # Project overview
├── quickstart.mdx         # Getting started guide
├── architecture/
│   ├── overview.mdx       # System architecture
│   ├── decisions/         # ADRs
│   │   └── adr-001.mdx
│   └── patterns.mdx       # Architecture patterns used
├── features/
│   └── {feature-name}/
│       ├── overview.mdx   # Feature overview
│       ├── requirements.mdx
│       └── implementation.mdx
├── api-reference/
│   └── {endpoint-group}/
│       └── endpoints.mdx
├── guides/
│   ├── development.mdx    # Dev setup guide
│   └── deployment.mdx     # Deployment guide
└── changelog.mdx          # Release notes
```

## Document Types

### Feature Documentation

Required for every new feature:

```mdx
---
title: "{Feature Name}"
description: "{Brief description}"
---

# {Feature Name}

## Overview

{What this feature does and why it exists}

## User Stories

{Link to Linear epic/stories}

## Architecture

{How it fits into the system}

## API

{Endpoints or interfaces}

## Usage

{How to use the feature}

## Configuration

{Any configuration options}
```

### ADR (Architecture Decision Record)

Required for significant technical decisions:

```mdx
---
title: "ADR-{number}: {Title}"
description: "{Brief description of decision}"
---

# ADR-{number}: {Title}

## Status

{Proposed | Accepted | Deprecated | Superseded by ADR-XXX}

## Context

{What is the issue we're seeing that motivates this decision}

## Decision

{What is the change we're proposing/have decided}

## Consequences

### Positive
- {benefit 1}
- {benefit 2}

### Negative
- {tradeoff 1}
- {tradeoff 2}

## Alternatives Considered

### {Alternative 1}
{Why not chosen}

### {Alternative 2}
{Why not chosen}
```

### API Documentation

```mdx
---
title: "{Endpoint Group}"
api: "{METHOD} {path}"
---

# {Endpoint Name}

{Description}

## Request

### Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| Authorization | string | Yes | Bearer token |

### Parameters

<ParamField path="id" type="string" required>
  The resource ID
</ParamField>

### Body

```json
{
  "field": "value"
}
```

## Response

<ResponseExample>

```json
{
  "id": "123",
  "name": "Example"
}
```

</ResponseExample>

## Errors

| Code | Description |
|------|-------------|
| 400 | Invalid request |
| 404 | Not found |
```

## Writing Guidelines

1. **Be concise**: Get to the point quickly
2. **Use examples**: Show, don't just tell
3. **Keep updated**: Update docs when code changes
4. **Link related docs**: Cross-reference related content
5. **Include Linear links**: Reference related issues


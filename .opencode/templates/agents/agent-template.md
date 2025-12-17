---
description: {{Brief description of agent purpose}}
mode: all
model: opencode/gemini-3-flash
temperature: 0.7
tools:
  read: true
  write: true
  edit: true
  bash: true
  task: true
---

# {{Agent Name}}

## Role

{{Detailed role definition describing what this agent does and its expertise}}

## Capabilities

- {{Capability 1}}
- {{Capability 2}}
- {{Capability 3}}

## Instructions

### Pre-Flight (If Applicable)

{{Any pre-flight checks like path validation}}

### Main Workflow

1. {{Step 1}}
2. {{Step 2}}
3. {{Step 3}}

## Guardrails

- {{Rule 1}}
- {{Rule 2}}
- {{Rule 3}}

## Delegation

This agent can delegate to:
- {{Agent 1}}: {{When to delegate}}
- {{Agent 2}}: {{When to delegate}}

This agent is invoked by:
- {{Agent 1}}: {{In what context}}
- {{Agent 2}}: {{In what context}}

## Integration

### Linear Integration
{{How this agent integrates with Linear for issue tracking}}

### Project Context
{{How this agent uses project-context.yaml for architecture awareness}}


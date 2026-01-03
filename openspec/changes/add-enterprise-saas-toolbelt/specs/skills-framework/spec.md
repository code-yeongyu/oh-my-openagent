# Delta for Skills Framework

## ADDED Requirements

### Requirement: Skill Registration
The system SHALL support registering skills with commands, handlers, and documentation.

#### Scenario: Register skill
- **WHEN** a skill is placed in `src/features/builtin-skills/`
- **THEN** the system loads SKILL.md, commands, and handlers
- **AND** makes the skill available via slash commands

#### Scenario: Skill discovery
- **WHEN** a user asks for available skills
- **THEN** the system lists all registered skills with descriptions

### Requirement: Knowledge Skill
The system SHALL provide a `/knowledge` skill for organizational knowledge management.

#### Scenario: Query knowledge
- **WHEN** user runs `/knowledge query "authentication patterns"`
- **THEN** the system searches knowledge across all layers
- **AND** returns relevant ADRs, policies, and patterns

#### Scenario: Propose knowledge
- **WHEN** user runs `/knowledge propose --type adr`
- **THEN** the system guides creation of a new ADR
- **AND** submits for approval based on layer

#### Scenario: List knowledge
- **WHEN** user runs `/knowledge list --layer org`
- **THEN** the system returns all org-level knowledge
- **AND** includes status and last updated

### Requirement: Debug Skill
The system SHALL provide a `/debug` skill for systematic debugging.

#### Scenario: Root cause tracing
- **WHEN** user runs `/debug trace "error message"`
- **THEN** the system traces the error through logs, metrics, and code
- **AND** identifies probable root cause

#### Scenario: Log analysis
- **WHEN** user runs `/debug logs --service api --since 1h`
- **THEN** the system queries Datadog or Grafana logs
- **AND** highlights anomalies

### Requirement: Deploy Skill
The system SHALL provide a `/deploy` skill for release orchestration.

#### Scenario: Release deployment
- **WHEN** user runs `/deploy release v1.2.0`
- **THEN** the system orchestrates the deployment pipeline
- **AND** reports status at each stage

#### Scenario: Rollback
- **WHEN** user runs `/deploy rollback`
- **THEN** the system reverts to previous deployment
- **AND** confirms rollback success

### Requirement: Test Skill
The system SHALL provide a `/test` skill for test automation.

#### Scenario: Run tests
- **WHEN** user runs `/test run --type e2e`
- **THEN** the system executes E2E tests via Playwright
- **AND** returns results with screenshots

#### Scenario: Generate test matrix
- **WHEN** user runs `/test matrix --feature login`
- **THEN** the system generates pairwise test combinations
- **AND** creates test cases for each combination

### Requirement: Review Skill
The system SHALL provide a `/review` skill for code review assistance.

#### Scenario: PR review
- **WHEN** user runs `/review pr #123`
- **THEN** the system analyzes the PR changes
- **AND** provides feedback on code quality, security, and tests

#### Scenario: Security review
- **WHEN** user runs `/review security`
- **THEN** the system runs Semgrep analysis
- **AND** reports vulnerabilities with remediation

### Requirement: Incident Skill
The system SHALL provide a `/incident` skill for incident response.

#### Scenario: Start incident
- **WHEN** user runs `/incident start --severity P1`
- **THEN** the system creates incident ticket
- **AND** notifies on-call via Slack or PagerDuty

#### Scenario: Generate postmortem
- **WHEN** user runs `/incident postmortem INC-123`
- **THEN** the system generates postmortem template
- **AND** populates timeline from logs and tickets

### Requirement: Progressive Disclosure Architecture
The system SHALL implement 3-level progressive disclosure for skills.

#### Scenario: Level 1 Metadata
- **WHEN** skills are loaded
- **THEN** only name and description are always in context
- **AND** metadata is under 100 words per skill

#### Scenario: Level 2 Instructions
- **WHEN** a skill is triggered
- **THEN** SKILL.md body is loaded into context
- **AND** instructions are under 5K words

#### Scenario: Level 3 Resources
- **WHEN** skill execution needs resources
- **THEN** scripts and references are loaded on-demand
- **AND** executed without full content in context

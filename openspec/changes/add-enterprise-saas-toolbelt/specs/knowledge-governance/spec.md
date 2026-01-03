# Delta for Knowledge Governance

## ADDED Requirements

### Requirement: Knowledge Commit Storage
The system SHALL store organizational knowledge as immutable commits with full audit trail.

#### Scenario: Create knowledge commit
- **WHEN** a user proposes new knowledge
- **THEN** the system creates an immutable commit with author, timestamp, and content
- **AND** the commit is assigned a unique identifier

#### Scenario: Query knowledge history
- **WHEN** a user requests knowledge history
- **THEN** the system returns all commits in chronological order
- **AND** each commit includes author, timestamp, and diff from previous

### Requirement: Knowledge Layer Hierarchy
The system SHALL organize knowledge in hierarchical layers: Company → Org → Project.

#### Scenario: Layer inheritance
- **WHEN** an agent queries project-level knowledge
- **THEN** the system returns project knowledge merged with inherited org and company knowledge
- **AND** lower layers can override higher layers

#### Scenario: Layer isolation
- **WHEN** a user creates project-level knowledge
- **THEN** the knowledge is not visible to other projects
- **UNLESS** promoted to org or company level

### Requirement: Knowledge Types
The system SHALL support multiple knowledge types: ADR, Policy, Pattern, Spec.

#### Scenario: ADR creation
- **WHEN** a user creates an Architectural Decision Record
- **THEN** the system stores it with status (proposed/accepted/deprecated/superseded)
- **AND** links to superseding ADR if applicable

#### Scenario: Policy enforcement
- **WHEN** a policy has severity BLOCK
- **THEN** AI agents MUST stop execution and report the violation
- **AND** provide remediation guidance

### Requirement: Constraint-Based Conflict Detection
The system SHALL detect conflicts using a constraint DSL.

#### Scenario: Technology ban detection
- **WHEN** code references a banned technology
- **THEN** the system raises a constraint violation
- **AND** includes the specific policy and remediation

#### Scenario: Required pattern detection
- **WHEN** code missing a required pattern is detected
- **THEN** the system raises a constraint violation with severity based on policy

### Requirement: Knowledge Manifest
The system SHALL provide a context-efficient manifest for AI agents.

#### Scenario: Manifest loading
- **WHEN** an AI session starts
- **THEN** the system loads a manifest with knowledge IDs and one-line summaries
- **AND** the manifest MUST be under 2K tokens

#### Scenario: On-demand policy loading
- **WHEN** keywords trigger a policy
- **THEN** the system loads the full policy text
- **AND** respects the 10K token budget for knowledge

### Requirement: Knowledge Promotion
The system SHALL support promoting knowledge between layers.

#### Scenario: Project to org promotion
- **WHEN** a project-level policy proves valuable
- **THEN** org owners can promote it to org level
- **AND** all projects inherit the policy

#### Scenario: Promotion audit
- **WHEN** knowledge is promoted
- **THEN** the system records promoter, timestamp, and justification

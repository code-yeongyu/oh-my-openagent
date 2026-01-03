# Delta for Agents Orchestration

## ADDED Requirements

### Requirement: Agent Registration
The system SHALL support registering agents with prompts, models, and tool access.

#### Scenario: Register agent
- **WHEN** an agent is defined in `src/agents/`
- **THEN** the system loads the agent with its prompt, model, and tool whitelist
- **AND** makes the agent available for delegation

#### Scenario: Agent discovery
- **WHEN** a user asks for available agents
- **THEN** the system lists all registered agents with their purposes

### Requirement: Knowledge Curator Agent
The system SHALL provide a `knowledge-curator` agent for knowledge lifecycle management.

#### Scenario: Knowledge curation
- **WHEN** delegated knowledge tasks
- **THEN** the agent validates knowledge format, checks conflicts, and proposes updates
- **AND** uses claude-sonnet-4-5 model

#### Scenario: Knowledge promotion review
- **WHEN** reviewing promotion requests
- **THEN** the agent analyzes impact across projects
- **AND** recommends approval or rejection with justification

### Requirement: Debugger Agent
The system SHALL provide a `debugger` agent for systematic debugging.

#### Scenario: Root cause analysis
- **WHEN** delegated debugging tasks
- **THEN** the agent follows systematic RCA methodology
- **AND** uses gpt-5.2 model for deep reasoning

#### Scenario: Multi-source correlation
- **WHEN** analyzing issues
- **THEN** the agent correlates logs, metrics, traces, and code
- **AND** identifies causal relationships

### Requirement: Test Engineer Agent
The system SHALL provide a `test-engineer` agent for test generation.

#### Scenario: Test generation
- **WHEN** delegated test tasks
- **THEN** the agent generates comprehensive test suites
- **AND** uses claude-sonnet-4-5 model

#### Scenario: Coverage analysis
- **WHEN** analyzing test coverage
- **THEN** the agent identifies gaps and generates missing tests

### Requirement: Security Reviewer Agent
The system SHALL provide a `security-reviewer` agent for security analysis.

#### Scenario: Vulnerability analysis
- **WHEN** delegated security review
- **THEN** the agent analyzes code for vulnerabilities
- **AND** uses gpt-5.2 model for security reasoning

#### Scenario: Compliance check
- **WHEN** checking compliance
- **THEN** the agent verifies against organizational security policies

### Requirement: DevOps Engineer Agent
The system SHALL provide a `devops-engineer` agent for infrastructure tasks.

#### Scenario: Infrastructure planning
- **WHEN** delegated infrastructure tasks
- **THEN** the agent plans and executes infrastructure changes
- **AND** uses claude-sonnet-4-5 model

#### Scenario: Deployment orchestration
- **WHEN** orchestrating deployments
- **THEN** the agent manages the full deployment lifecycle

### Requirement: Code Reviewer Agent
The system SHALL provide a `code-reviewer` agent for thorough code review.

#### Scenario: PR review
- **WHEN** delegated PR review
- **THEN** the agent performs comprehensive review using evaluation harness
- **AND** uses gpt-5.2 model

#### Scenario: Architecture review
- **WHEN** reviewing architectural changes
- **THEN** the agent validates against organizational patterns

### Requirement: Incident Commander Agent
The system SHALL provide an `incident-commander` agent for incident coordination.

#### Scenario: Incident management
- **WHEN** delegated incident tasks
- **THEN** the agent coordinates response, communication, and resolution
- **AND** uses gpt-5.2 model

#### Scenario: Postmortem generation
- **WHEN** generating postmortems
- **THEN** the agent compiles timeline, root cause, and action items

### Requirement: Agent Model Selection
The system SHALL select appropriate models based on task requirements.

#### Scenario: Reasoning tasks
- **WHEN** task requires deep reasoning such as debugging, security, or architecture
- **THEN** use gpt-5.2 model
- **AND** temperature is at most 0.1

#### Scenario: Generation tasks
- **WHEN** task requires content generation such as tests, docs, or code
- **THEN** use claude-sonnet-4-5 model
- **AND** temperature is at most 0.3

### Requirement: Agent Tool Access Control
The system SHALL enforce tool whitelists per agent.

#### Scenario: Tool restriction
- **WHEN** an agent attempts to use a non-whitelisted tool
- **THEN** the system blocks the request
- **AND** logs the violation

#### Scenario: Minimal tool access
- **WHEN** configuring agents
- **THEN** each agent has minimal tools needed for its domain
- **AND** no agent has access to all tools

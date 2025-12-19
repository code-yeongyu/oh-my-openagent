# oh-my-opencode Constitution

<!--
TEMPLATE METADATA:
Version: 1.1.0
Purpose: Core principles governing oh-my-opencode development
Last Updated: 2025-12-18

MAINTENANCE:
- WHO: Project maintainer with team consensus
- WHEN: Core project principles change, new fundamental constraints identified
- HOW: Use /update-context command or follow amendment process below

VERSIONING RULES:
- MAJOR: Backward incompatible governance/principle removals or redefinitions
- MINOR: New principle/section added or materially expanded guidance
- PATCH: Clarifications, wording, typo fixes, non-semantic refinements
-->

## Core Principles

### I. Plugin-First Architecture

All features MUST be implemented through the official `@opencode-ai/plugin` SDK. We extend OpenCode, we don't fork or modify it.

**Rationale**: Ensures compatibility with OpenCode updates and maintains clean separation between core and extensions.

### II. Multi-Model Excellence

Agents SHOULD leverage the optimal AI model for each task. Different models excel at different capabilities.

**Rationale**: Claude excels at complex reasoning, GPT at strategic thinking, Gemini at UI/multimodal, Grok at fast exploration. Using the right tool for the job improves outcomes.

### III. Multi-Layered Agent Orchestration

Complex tasks SHOULD be delegated through a hierarchical agent structure with clear role separation:

**Agent Hierarchy**:
```
OmO (Team Lead - Claude Opus)
├── implementation-specialist (Manager - Claude Sonnet)
│   ├── Language Specialists (backend-typescript, backend-rust, backend-python)
│   ├── Frontend Specialists (frontend-react, frontend-ui-ux-engineer)
│   ├── Mobile Specialists (mobile-xcode, mobile-react-native)
│   ├── AI/ML Specialists (ai-ml-expert, agent-specialist)
│   └── Cross-Cutting (security-specialist, test-specialist, optimization-specialist)
├── oracle (Advisor - GPT-5.2) - read-only
├── librarian (Utility - Claude Sonnet) - read-only
├── explore (Utility - Grok) - read-only
└── multimodal-looker (Utility - Gemini Flash) - read-only
```

**Role Definitions**:
- **Team Lead**: High-level orchestration, task decomposition, quality assurance
- **Manager**: Coordinates domain specialists, handles multi-domain tasks
- **Specialist**: Deep domain expertise, focused implementation
- **Advisor**: Strategic guidance, architecture review (read-only)
- **Utility**: Information gathering, exploration (read-only)

**Governance Levels**:
- File-modifying agents receive governance injection (path validation, Linear tracking)
- Read-only agents are excluded from governance overhead

**Rationale**: Hierarchical delegation enables specialization, reduces cognitive load on any single agent, and ensures domain experts handle domain-specific work.

### IV. Bun-Native Development

All development MUST use Bun exclusively - for package management, runtime, and builds. Never use npm, yarn, or pnpm.

**Rationale**: Bun provides faster installation, native TypeScript support, and simpler builds. Consistency prevents "works on my machine" issues.

### V. Hook-Driven Enhancement

Features SHOULD be implemented as lifecycle hooks when possible, enabling non-invasive extension and easy enable/disable via configuration.

**Rationale**: Hooks provide clear separation of concerns, easy testing, and allow users to customize their experience without code changes.

### VI. Dogfooding

We MUST use oh-my-opencode to develop oh-my-opencode. The `.opencode/` and `.cursor/` directories contain our own agent definitions and commands.

**Rationale**: Eating our own cooking ensures we experience the same workflow as users, catching issues early and driving improvements.

### VII. GitHub Actions Publishing Only

Publishing MUST only happen through GitHub Actions workflow_dispatch. Never run `bun publish` directly. Never bump versions locally.

**Rationale**: OIDC provenance requires CI-based publishing. Local publishing breaks the trust chain and provenance attestation.

## Technology Stack

- **Language**: TypeScript 5.7+
- **Runtime**: Bun >= 1.0.0
- **Framework**: @opencode-ai/plugin SDK
- **Testing**: Not yet configured (future work)
- **Documentation**: README.md (EN), README.ko.md (KO), README.ja.md (JA)

## Development Workflow

1. Track work in Linear issues (LIF-xxx)
2. Create feature branch from Linear
3. Implement using spec-driven workflow
4. Test via dogfooding
5. Create PR via GitHub Actions
6. Publish via workflow_dispatch

## Amendment Process

Modifications to this constitution require:
- Explicit documentation of rationale
- Review and approval by project maintainer
- Assessment of impact on existing features
- Version bump following semantic versioning rules

**Version**: 1.1.0 | **Ratified**: 2025-12-17 | **Last Amended**: 2025-12-18

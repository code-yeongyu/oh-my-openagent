# Feature Specification: Update Rule-Engineer Agent for Cursor Agents, Rules, and AGENTS.md

**Feature ID**: `LIF-56-refactor-rule-engineer-agent`  
**Created**: 2025-12-17  
**Updated**: 2025-12-17  
**Status**: Draft  
**Linear Issue**: [LIF-56](https://linear.app/lifecraft/issue/LIF-56)  
**Branch**: `hello/lif-56-update-rule-engineer-agent-to-cover-cursor-agents-rules-and`

## Executive Summary

Update the rule-engineer agent in OpenCode (`.opencode/agent/rule-engineer.md`) to comprehensively cover Cursor agents (`.cursor/agents/*.md`), Cursor rules with proper standards, and AGENTS.md files. The current agent (217 lines) has critical gaps identified in audit, including deprecated references to non-existent custom-modes, missing Cursor agents coverage, and incomplete AGENTS.md guidance.

**Audit Reference**: `.cursor/specs/_audits/rule-engineer-audit-2025-12-16.md`  
**Current Compliance Score**: 45/100  
**Target Compliance Score**: 90+/100

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cursor Agent Management (Priority: P1)

As a **system administrator**, I want the rule-engineer to create and update Cursor agents at `.cursor/agents/*.md` so that I can maintain the agent ecosystem with proper validation and consistent structure.

**Why this priority**: Cursor agents are actively used for AI-assisted development. Without proper management guidance, agents may be created with invalid YAML, incorrect tool permissions, or missing required fields, causing runtime failures.

**Independent Test**: Can be fully tested by requesting "create a new Cursor agent for code review" and verifying the output has valid YAML frontmatter, correct file location, and passes 5-layer validation.

**Acceptance Scenarios**:

1. **Given** a request to create a new Cursor agent, **When** the rule-engineer processes the request, **Then** the agent file is created at `.cursor/agents/{agent-name}.md` (flat structure, no subdirectories) with valid YAML frontmatter containing `description`, `mode`, `model`, and `tools` fields.

2. **Given** an existing Cursor agent needs updating, **When** the rule-engineer modifies it, **Then** the update preserves existing structure, validates all cross-references, and maintains backward compatibility.

3. **Given** a request references the deprecated `.cursor/custom-modes/` path, **When** the rule-engineer processes it, **Then** it redirects to the correct `.cursor/agents/` location and warns about the deprecated path.

---

### User Story 2 - AGENTS.md Comprehensive Guidance (Priority: P1)

As a **developer**, I want the rule-engineer to provide comprehensive AGENTS.md guidance so that I can create consistent directory-based agent rules following documented templates.

**Why this priority**: AGENTS.md files provide critical context for AI tools. The current 13-line section is insufficient; developers need templates, format standards, and clear guidance on when to create root vs. directory-based AGENTS.md files.

**Independent Test**: Can be fully tested by requesting "create an AGENTS.md for the src/ directory" and verifying the output follows the documented template structure with all required sections.

**Acceptance Scenarios**:

1. **Given** a request to create a root AGENTS.md, **When** the rule-engineer processes it, **Then** the output includes: Build & Test Commands, Code Style (Language, Imports, Formatting, Types, Documentation, Performance), and Architecture Notes sections.

2. **Given** a request to create a directory AGENTS.md, **When** the rule-engineer processes it, **Then** the output includes: Purpose, Key Files, Local Conventions, Testing, and Integration Points sections.

3. **Given** AGENTS.md content is created, **When** validation runs, **Then** all referenced commands are verified to work and all file references point to existing files.

4. **Given** a project with nested directories, **When** the rule-engineer advises on AGENTS.md placement, **Then** it explains that root AGENTS.md applies project-wide, and subdirectory AGENTS.md files inherit from parent and can override/extend.

5. **Given** a request to optimize AGENTS.md coverage, **When** the rule-engineer analyzes the directory structure, **Then** it recommends strategic placement based on parent/child/grandchild inheritance to minimize duplication while maximizing coverage.

6. **Given** conflicting guidance between parent and child AGENTS.md, **When** the rule-engineer is asked about precedence, **Then** it explains that child AGENTS.md takes precedence for its directory (closer scope wins).

---

### User Story 3 - Correct Flat Structure Paths (Priority: P1)

As a **governance maintainer**, I want the rule-engineer to use correct flat structure paths so that file operations don't fail due to non-existent subdirectories.

**Why this priority**: The current agent references non-existent subdirectories (`governance/`, `planning/`, etc.) for OpenCode agents. This causes file creation failures and confusion. OpenCode uses a flat structure.

**Independent Test**: Can be fully tested by requesting "create a new governance agent" and verifying the file is created at `.opencode/agent/{agent-name}.md` (NOT `.opencode/agent/governance/{agent-name}.md`).

**Acceptance Scenarios**:

1. **Given** a request to create an OpenCode agent, **When** the rule-engineer determines the path, **Then** it uses `.opencode/agent/{agent-name}.md` (flat structure) and never creates subdirectories.

2. **Given** a request to create a Cursor agent, **When** the rule-engineer determines the path, **Then** it uses `.cursor/agents/{agent-name}.md` (flat structure) and never creates subdirectories.

3. **Given** documentation references agent categories, **When** the rule-engineer outputs location information, **Then** categories are described as "logical groupings for documentation only" with explicit note that files remain in flat structure.

---

### User Story 4 - Enhanced 5-Layer Validation (Priority: P2)

As a **quality engineer**, I want the rule-engineer to have detailed 5-layer validation with specific thresholds so that all agents/rules pass rigorous quality checks before being saved.

**Why this priority**: Current validation guidance is 30 lines vs. 150 lines in reference. Missing specific thresholds, error patterns, and recovery procedures leads to inconsistent quality.

**Independent Test**: Can be fully tested by providing an agent file with a known validation issue (e.g., glob pattern matching 0 files) and verifying the rule-engineer identifies the specific issue with actionable fix guidance.

**Acceptance Scenarios**:

1. **Given** a rule with glob pattern `src/*.py` (root-only), **When** 5-layer validation runs, **Then** Layer 2 fails with message "Pattern matches 0 files - use `src/**/*.py` for recursive matching".

2. **Given** an agent file exceeding 500 lines, **When** Layer 4 validation runs, **Then** it provides analysis of content composition (examples %, explanation %, code %) and recommends specific action (condense, split, or refactor).

3. **Given** a validation failure, **When** the rule-engineer attempts recovery, **Then** it follows the documented recovery pattern: identify layer, analyze cause, apply fix, re-validate, and never proceeds with failed validation.

---

### User Story 5 - Chain-of-Thought Reasoning Patterns (Priority: P2)

As an **AI assistant user**, I want the rule-engineer to include reasoning patterns so that the agent produces higher quality, well-reasoned outputs with explicit analysis steps.

**Why this priority**: Without explicit reasoning patterns, the agent may skip critical analysis steps, leading to lower quality outputs. Reference version has 100+ lines of reasoning patterns; current has 0.

**Independent Test**: Can be fully tested by requesting a rule update and verifying the output includes explicit reasoning chain (task classification, target determination, validation depth) and self-reflection checkpoints.

**Acceptance Scenarios**:

1. **Given** any rule-engineer request, **When** processing begins, **Then** the agent outputs a reasoning chain including: restated request, operation type (CREATE/UPDATE/FIX), target type (AGENT/RULE/AGENTS.MD), and validation depth.

2. **Given** changes are designed, **When** self-reflection runs, **Then** the agent explicitly validates: "Addresses user request?", "Follows standards?", "Introduces duplication?" with Yes/No answers.

3. **Given** validation completes, **When** final self-reflection runs, **Then** the agent confirms: "All validations pass?", "User request satisfied?", "No regression?" before saving.

---

### User Story 6 - DeepWiki-Informed Agent Optimization (Priority: P1)

As a **system administrator**, I want the rule-engineer to use DeepWiki to query sst/opencode for authoritative guidance so that agent configurations follow official OpenCode best practices.

**Why this priority**: OpenCode evolves and has specific patterns for agent configuration, tool permissions, and optimization. Without authoritative source queries, the rule-engineer may provide outdated or incorrect guidance.

**Independent Test**: Can be fully tested by requesting "optimize the orchestrator agent's tool permissions" and verifying the rule-engineer queries DeepWiki for sst/opencode patterns before making recommendations.

**Acceptance Scenarios**:

1. **Given** a request about OpenCode agent configuration, **When** the rule-engineer needs authoritative information, **Then** it queries DeepWiki for `sst/opencode` and cites the source in its response.

2. **Given** uncertainty about OpenCode tool permissions or schema, **When** the rule-engineer processes the request, **Then** it queries DeepWiki before providing guidance rather than guessing.

3. **Given** a request to optimize an agent, **When** the rule-engineer provides recommendations, **Then** recommendations are backed by DeepWiki research with specific citations.

---

### Edge Cases

- **Deprecated path handling**: When user references `.cursor/custom-modes/`, redirect to `.cursor/agents/` with deprecation warning
- **Conflicting agent names**: When creating agent with name that exists in both OpenCode and Cursor, clarify which location is intended
- **Cross-platform paths**: Handle both forward and backslash paths consistently
- **Empty glob matches**: Distinguish between "pattern broken" (0 matches) vs. "intentionally narrow" (1-5 matches)
- **Circular cross-references**: Detect and prevent mdc: links that create circular dependencies
- **Large file approval flow**: When file exceeds acceptable size, require explicit user approval before saving

---

## Requirements *(mandatory)*

### Functional Requirements

#### FR-100: Remove Deprecated References
- **FR-101**: Agent MUST NOT reference `.cursor/custom-modes/*.md` (deprecated/non-existent)
- **FR-102**: Agent MUST replace all "custom modes" terminology with "Cursor agents"
- **FR-103**: Agent MUST update capabilities list to remove custom modes and add Cursor agents

#### FR-200: Agent Coverage - Both Platforms
- **FR-201**: Agent MUST document Cursor agent location as `.cursor/agents/*.md` (flat structure)
- **FR-202**: Agent MUST include Cursor agent YAML frontmatter requirements: `description`, `mode`, `model`, `tools`
- **FR-203**: Agent MUST reference Cursor agent index files: `modes.json`, `COMPLETE_INDEX.md`, `README.md`
- **FR-204**: Agent MUST document Cursor agent creation workflow with validation steps
- **FR-205**: Agent MUST include guidance for updating agent indexes after creation/modification
- **FR-206**: Agent MUST manage OpenCode agents at `.opencode/agent/*.md` with equal capability to Cursor agents
- **FR-207**: Agent MUST understand differences between OpenCode and Cursor agent schemas (frontmatter fields, tool configurations)
- **FR-208**: Agent MUST be able to sync/compare agents between OpenCode and Cursor when requested

#### FR-300: AGENTS.md Comprehensive Section
- **FR-301**: Agent MUST include root AGENTS.md template with sections: Build & Test Commands, Code Style, Architecture Notes
- **FR-302**: Agent MUST include directory AGENTS.md template with sections: Purpose, Key Files, Local Conventions, Testing, Integration Points
- **FR-303**: Agent MUST document when to create/update AGENTS.md (triggers and conditions)
- **FR-304**: Agent MUST include AGENTS.md validation steps: verify commands work, check file references, test with AI
- **FR-305**: AGENTS.md section MUST be ~100 lines (currently 13 lines, increased from 80 to include hierarchical inheritance)
- **FR-306**: Agent MUST document AGENTS.md hierarchical inheritance: root AGENTS.md applies to entire project, directory AGENTS.md applies to that directory and all subdirectories
- **FR-307**: Agent MUST explain parent→child→grandchild trickle-down: rules cascade from parent directories to child directories (top-down inheritance)
- **FR-308**: Agent MUST document that child AGENTS.md can override or extend parent AGENTS.md rules
- **FR-309**: Agent MUST provide guidance on strategic placement of AGENTS.md files to optimize rule coverage (e.g., place common rules at higher levels, specific rules at lower levels)
- **FR-310**: Agent MUST include examples of hierarchical AGENTS.md structure showing inheritance patterns

#### FR-400: Correct Agent Location Paths
- **FR-401**: Agent MUST document OpenCode agents use FLAT structure at `.opencode/agent/*.md`
- **FR-402**: Agent MUST document Cursor agents use FLAT structure at `.cursor/agents/*.md`
- **FR-403**: Agent MUST NOT reference non-existent subdirectories (`governance/`, `planning/`, etc.)
- **FR-404**: Agent MUST include logical categories table for documentation purposes only
- **FR-405**: Agent MUST include visual directory tree showing actual flat structure

#### FR-500: Enhanced 5-Layer Validation
- **FR-501**: Layer 1 (YAML) MUST include specific error patterns to check
- **FR-502**: Layer 2 (Glob) MUST include match count thresholds: 0=CRITICAL, 1-5=WARNING, 6-200=GOOD, 201-1000=WARNING, >1000=CRITICAL
- **FR-503**: Layer 3 (Cross-refs) MUST include resolution algorithm for relative paths
- **FR-504**: Layer 4 (Size) MUST include thresholds by type: Rules <500, Agents <800, AGENTS.md <400
- **FR-505**: Layer 5 (Duplication) MUST include methodology for similarity detection
- **FR-506**: Validation section MUST be ~100 lines (currently 30 lines)

#### FR-600: Reasoning Patterns
- **FR-601**: Agent MUST include chain-of-thought reasoning pattern for request analysis
- **FR-602**: Agent MUST include self-reflection checkpoints after each major step
- **FR-603**: Agent MUST include debugging patterns for common issues (glob not matching, validation failure)
- **FR-604**: Agent MUST include validation failure recovery pattern

#### FR-700: Delegation Updates
- **FR-701**: Agent MUST include context-steward as MANDATORY delegation for path validation
- **FR-702**: Agent MUST include historian as MANDATORY delegation for changelog entries
- **FR-703**: Agent MUST separate MANDATORY vs OPTIONAL delegations clearly
- **FR-704**: Agent MUST include orchestrator in "invoked by" list

#### FR-800: DeepWiki Integration
- **FR-801**: Agent MUST use DeepWiki to query `sst/opencode` repository for authoritative information on OpenCode agent configuration
- **FR-802**: Agent MUST query DeepWiki when encountering unfamiliar OpenCode patterns, tool configurations, or schema questions
- **FR-803**: Agent MUST use DeepWiki to verify best practices for agent optimization before making recommendations
- **FR-804**: Agent MUST cite DeepWiki sources when providing OpenCode-specific guidance

### Non-Functional Requirements

- **NFR-001**: Updated agent file MUST be under 500 lines (target: 450-500 lines)
- **NFR-002**: All cross-references MUST resolve to existing files
- **NFR-003**: YAML frontmatter MUST be valid and parseable
- **NFR-004**: All glob patterns in examples MUST be tested against actual project structure
- **NFR-005**: Agent MUST maintain backward compatibility with existing invocations
- **NFR-006**: Agent MUST follow OpenCode agent frontmatter schema

### Key Entities

- **OpenCode Agent**: Agent definition file at `.opencode/agent/*.md` with YAML frontmatter (mode, model, temperature, tools, description)
- **Cursor Agent**: Agent definition file at `.cursor/agents/*.md` with similar structure but Cursor-specific configuration
- **Cursor Rule**: Rule file at `.cursor/rules/**/*.mdc` with YAML frontmatter (description, globs, alwaysApply)
- **AGENTS.md**: Context file for AI tools, either root-level (project overview) or directory-level (feature-specific guidance), with hierarchical inheritance from parent to child directories

#### AGENTS.md Hierarchical Inheritance

AGENTS.md files follow **top-down inheritance**:

```
project/
├── AGENTS.md                    # Level 0: Applies to ENTIRE project
├── src/
│   ├── AGENTS.md                # Level 1: Inherits from root, applies to src/ and below
│   ├── components/
│   │   ├── AGENTS.md            # Level 2: Inherits from src/, applies to components/ and below
│   │   └── Button/
│   │       └── AGENTS.md        # Level 3: Most specific, inherits from all above
│   └── utils/
│       └── (no AGENTS.md)       # Inherits from src/AGENTS.md
└── tests/
    └── AGENTS.md                # Level 1: Inherits from root, applies to tests/
```

**Inheritance Rules**:
1. **Root applies everywhere**: `/AGENTS.md` guidance applies to all directories
2. **Child inherits parent**: `src/AGENTS.md` inherits all rules from root
3. **Child can override**: `src/AGENTS.md` can override specific root rules for its scope
4. **Child can extend**: `src/AGENTS.md` can add rules not in root
5. **Closest scope wins**: For conflicts, the most specific (deepest) AGENTS.md takes precedence

**Strategic Placement**:
- **Root**: Build commands, code style, architecture overview (applies everywhere)
- **Feature directories**: Feature-specific conventions, testing requirements
- **Specialized directories**: Unique patterns (e.g., `tests/AGENTS.md` for test conventions)

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Rule-engineer can create/update Cursor agents with 100% validation pass rate (all 5 layers pass on first attempt for valid requests)
- **SC-002**: Rule-engineer can create/update AGENTS.md files following documented templates with 100% section completeness
- **SC-003**: All file operations use correct paths with zero path-related failures (no attempts to create files in non-existent subdirectories)
- **SC-004**: 5-layer validation catches 95%+ of common errors before save (measured by post-deployment error rate)
- **SC-005**: Agent compliance score improves from 45 to 90+ (per audit methodology in `.cursor/specs/_audits/rule-engineer-audit-2025-12-16.md`)
- **SC-006**: Updated agent file size is 450-550 lines (up from 217, down from reference 962 - balanced completeness, increased ceiling for new requirements)
- **SC-007**: All 4 rule management files (`.cursor/rules/08-rule-management/`) are referenced with key insights
- **SC-008**: Rule-engineer successfully queries DeepWiki for sst/opencode when encountering OpenCode-specific questions (measured by DeepWiki tool usage in responses)
- **SC-009**: AGENTS.md guidance includes hierarchical inheritance documentation with examples
- **SC-010**: Rule-engineer can manage both OpenCode and Cursor agents with equal proficiency

---

## Constraints

- **C-001**: Must maintain backward compatibility with existing rule-engineer invocations
- **C-002**: Must follow OpenCode agent frontmatter schema (mode, model, temperature, tools, description)
- **C-003**: Must integrate with governance agents (context-steward pre-flight, historian post-work)
- **C-004**: Must reference `.cursor/rules/08-rule-management/` standards for rule creation guidance
- **C-005**: Must not exceed 500 lines to remain maintainable
- **C-006**: Must use flat structure for agent locations (no subdirectories)

---

## Assumptions

- **A-001**: OpenCode and Cursor will continue using flat agent structures (no planned migration to subdirectories)
- **A-002**: The 4 rule management files in `.cursor/rules/08-rule-management/` are authoritative standards
- **A-003**: AGENTS.md format is stable and follows established conventions
- **A-004**: Context-steward and historian agents are available and functional for mandatory delegations

---

## Out of Scope

- **OS-002**: User-facing documentation (Documentation Master handles)
- **OS-003**: Code implementation (Implementation Specialist handles)
- **OS-004**: Strategic recommendations (Strategic Architect handles)
- **OS-005**: Cursor agent index file creation (separate task, rule-engineer only documents the process)
- **OS-006**: Migration of existing agents to new structure (this spec covers the agent definition, not migration execution)

> **Note**: Pattern analysis (previously OS-001) is now IN SCOPE - the rule-engineer SHOULD be able to do pattern analysis for rules/agents it manages.

---

## Implementation Phases

Based on audit recommendations and expanded requirements:

| Phase | Changes | Estimated Effort | Dependencies |
|-------|---------|------------------|--------------|
| **Phase 1** | Fix outdated references (Proposals 1, 2, 3) | 30 min | None |
| **Phase 2** | Add AGENTS.md section with hierarchical inheritance (Proposal 4 + FR-306-310) | 60 min | Phase 1 |
| **Phase 3** | Expand 5-layer validation (Proposal 5) | 60 min | Phase 1 |
| **Phase 4** | Add reasoning patterns (Proposal 6) | 45 min | Phase 3 |
| **Phase 5** | Update delegation section | 15 min | Phase 1 |
| **Phase 6** | Enhance rule references | 15 min | Phase 1 |
| **Phase 7** | Add DeepWiki integration guidance (FR-800) | 20 min | Phase 1 |
| **Phase 8** | Add OpenCode agent coverage (FR-206-208) | 20 min | Phase 1 |

**Total Estimated Effort**: ~4 hours

---

## References

- **Audit Report**: `.cursor/specs/_audits/rule-engineer-audit-2025-12-16.md`
- **Current Agent**: `.opencode/agent/rule-engineer.md` (217 lines)
- **Reference Agent**: `.cursor/agents/rule-engineer.md` (962 lines)
- **Rule Management Standards**: `.cursor/rules/08-rule-management/` (4 rule files)
- **Governance Instructions**: `.opencode/instructions/governance.md`

---

## Handoff

After this specification is approved:
1. **Strategic Architect** reviews for technical feasibility and architecture alignment
2. **Implementation Specialist** executes the 6-phase update plan
3. **Agent Auditor** validates the updated agent against audit criteria
4. **Historian** creates changelog entry documenting the update

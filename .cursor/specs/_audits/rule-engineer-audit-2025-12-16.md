# Rule Engineer Agent Audit Report - 2025-12-16

## Executive Summary

**Agent Audited**: `.opencode/agent/rule-engineer.md`  
**Current Size**: 217 lines  
**Reference Version**: `.cursor/agents/rule-engineer.md` (962 lines)  
**Compliance Score**: 45/100  
**Critical Issues**: 5  
**High Priority Improvements**: 8  
**Medium Priority Improvements**: 4  
**Low Priority Improvements**: 2  

### Key Findings

1. **CRITICAL**: References deprecated "custom modes" at `.cursor/custom-modes/*.md` - **MODES ARE GONE**
2. **CRITICAL**: Missing coverage for Cursor agents at `.cursor/agents/*.md`
3. **CRITICAL**: Missing comprehensive AGENTS.md guidance
4. **CRITICAL**: Agent location paths reference non-existent subdirectories (`governance/`, `planning/`, etc.)
5. **CRITICAL**: Instructions are 78% thinner than reference version, missing critical validation details

### Recommended Priority Updates

| Priority | Issue | Impact |
|----------|-------|--------|
| P0 | Remove custom modes references | Prevents confusion |
| P0 | Add Cursor agents coverage | Enables agent management |
| P0 | Fix agent location paths | Prevents file creation errors |
| P1 | Add AGENTS.md section | Enables tool-specific guidance |
| P1 | Port 5-layer validation details | Ensures quality |
| P2 | Add chain-of-thought patterns | Improves reasoning |
| P2 | Add self-reflection checkpoints | Improves output quality |

---

## Detailed Gap Analysis

### 1. Outdated References (CRITICAL)

#### Issue 1.1: Custom Modes Reference (Line 19)

**Current Content**:
```markdown
You are a system configuration engineer specializing in OpenCode agents, Cursor rules (`.cursor/rules/*.mdc`), custom modes (`.cursor/custom-modes/*.md`), and Orchestrator commands.
```

**Problem**: 
- References `.cursor/custom-modes/*.md` which **does not exist**
- Custom modes are **deprecated/removed** from the project
- Cursor now uses **agents** at `.cursor/agents/*.md`

**Evidence**:
- `glob('.cursor/custom-modes/*.md')` returns: **0 files**
- `glob('.cursor/agents/*.md')` returns: **27 files**
- `modes.json` at `.cursor/agents/modes.json` defines agent configurations

**Proposed Fix**:
```markdown
You are a system configuration engineer specializing in OpenCode agents (`.opencode/agent/*.md`), Cursor agents (`.cursor/agents/*.md`), Cursor rules (`.cursor/rules/**/*.mdc`), AGENTS.md files, and Orchestrator commands.
```

#### Issue 1.2: Capabilities Section (Lines 23-33)

**Current Content**:
```markdown
## Capabilities

- OpenCode agent creation and updates
- Cursor rules creation and updates (`.cursor/rules/**/*.mdc`)
- Custom modes creation and updates (`.cursor/custom-modes/*.md`)
- Orchestrator agent/command updates
```

**Problem**: Lists "Custom modes" which don't exist

**Proposed Fix**:
```markdown
## Capabilities

- OpenCode agent creation and updates (`.opencode/agent/*.md`)
- Cursor agent creation and updates (`.cursor/agents/*.md`)
- Cursor rules creation and updates (`.cursor/rules/**/*.mdc`)
- AGENTS.md file maintenance (root and directory-based)
- Orchestrator agent/command updates (`.opencode/agent/orchestrator.md`)
- 5-layer validation: YAML syntax, glob patterns, cross-references, size limits, duplication
- Tool configuration and delegation pattern design
- Agent index maintenance (`modes.json`, `COMPLETE_INDEX.md`, `README.md`)
```

#### Issue 1.3: Custom Mode Locations Section (Lines 200-203)

**Current Content**:
```markdown
### Custom Mode Locations

All custom modes in `.cursor/custom-modes/`:
- Individual mode files (`.md`)
```

**Problem**: This entire section references non-existent location

**Proposed Fix**: Replace with Cursor Agents section:
```markdown
### Cursor Agent Locations

All Cursor agents in `.cursor/agents/`:
- Individual agent files (`{agent-name}.md`)
- Configuration: `modes.json` (agent metadata and settings)
- Index files: `COMPLETE_INDEX.md`, `README.md`, `QUICK_START.md`
- Workflow guides: `FEATURE_WORKFLOW.md`, `WORKFLOW_PATTERNS.md`
```

---

### 2. Agent Location Paths (CRITICAL)

#### Issue 2.1: Subdirectory References (Lines 179-186)

**Current Content**:
```markdown
### Agent Locations

All agents in `.opencode/agent/`:
- `governance/` - Governance agents
- `planning/` - Planning agents
- `implementation/` - Implementation agents
- `quality/` - Quality agents
- `specialized/` - Specialized agents
```

**Problem**: 
- OpenCode uses **FLAT structure** - no subdirectories
- These subdirectory paths don't exist
- Will cause file creation errors if followed

**Evidence**:
```bash
ls .opencode/agent/
# Returns: 25 .md files directly in folder, NO subdirectories
```

**Proposed Fix**:
```markdown
### Agent Locations

**OpenCode Agents** (flat structure):
All agents in `.opencode/agent/*.md` - NO subdirectories:
- 25 agent files directly in folder
- Uses kebab-case naming (e.g., `context-steward.md`)
- Registry at `registry.json`

**Cursor Agents** (flat structure):
All agents in `.cursor/agents/*.md`:
- 21 agent files + index files
- Configuration at `modes.json`
- Index at `COMPLETE_INDEX.md`

**Logical Categories** (for documentation only):
| Category | Agents |
|----------|--------|
| Governance | context-steward, historian, agent-auditor, meta-improvement-analyst |
| Planning | product-strategist, strategic-architect, linear-coordinator |
| Implementation | implementation-specialist, quick-fixer, devops-specialist |
| Quality | code-reviewer, test-engineer, documentation-master, chat-auditor |
| Specialized | rag-architect, ml-engineer, ai-engineer-agentic, project-guru, etc. |
```

---

### 3. Missing AGENTS.md Coverage (CRITICAL)

#### Issue 3.1: Incomplete AGENTS.md Section (Lines 118-130)

**Current Content**:
```markdown
### AGENTS.md Maintenance

1. **Read Existing**
   - Understand current guidance
   - Identify gaps

2. **Update Content**
   - Architecture patterns
   - Layer responsibilities
   - Code organization

3. **Validate Accuracy**
   - Check against actual code
   - Verify patterns exist
```

**Problem**: 
- Too brief (13 lines vs. needed ~80 lines)
- Missing format standards
- Missing root vs. directory-based distinction
- Missing when to create/update guidance
- No examples provided

**Proposed Fix**: See Proposal 4 below for complete replacement section.

---

### 4. Instruction Completeness Gaps (HIGH)

#### Issue 4.1: Missing Chain-of-Thought Reasoning

**Current**: No explicit reasoning patterns documented

**Reference Version Has** (Lines 194-229):
```markdown
**Step 1: Analyze Request (Chain-of-Thought)**

REASONING CHAIN:

1. "User wants to: {restate request in own words}"
2. "This is a: {CREATE | UPDATE | FIX} operation"
3. "Target type: {RULE | AGENT | COMMAND}"
4. "Scope: {NEW | EXISTING | MULTIPLE}"
5. "Validation depth: {SYNTAX_ONLY | FULL_VALIDATION}"
```

**Impact**: Without explicit reasoning patterns, agent may skip critical analysis steps

#### Issue 4.2: Missing Self-Reflection Checkpoints

**Current**: No self-reflection documented

**Reference Version Has** (Lines 256-262):
```markdown
SELF-REFLECTION:
"What am I changing and why?"
- Current state: {summary}
- Proposed change: {summary}
- Expected outcome: {summary}
```

**Impact**: Without self-reflection, agent may produce lower quality outputs

#### Issue 4.3: Missing Advanced Debugging Patterns

**Current**: No debugging patterns

**Reference Version Has** (Lines 687-787):
- Pattern 1: Glob Pattern Debugging
- Pattern 2: Rule Splitting Decision
- Pattern 3: Validation Failure Recovery

**Impact**: Agent lacks guidance for handling edge cases and failures

---

### 5. 5-Layer Validation Gaps (HIGH)

#### Issue 5.1: Validation Details Too Brief

**Current** (Lines 88-117): 30 lines of validation guidance

**Reference Version** (Lines 315-465): 150 lines of detailed validation

**Missing Details**:
- Specific YAML error patterns to check
- Glob pattern match count thresholds
- Cross-reference resolution algorithm
- Size limit handling with user approval flow
- Duplication detection methodology

**Proposed Enhancement**: See Proposal 5 below.

---

### 6. Rule References (MEDIUM)

#### Issue 6.1: Rule References Present but Could Be Enhanced

**Current** (Lines 211-216):
```markdown
## Rule References

- Rule: `.cursor/rules/08-rule-management/rule_creation.mdc` - Rule creation standards
- Rule: `.cursor/rules/08-rule-management/rule_validation.mdc` - Validation procedures
- Rule: `.cursor/rules/08-rule-management/glob_patterns.mdc` - Glob pattern guide
- Rule: `.cursor/rules/08-rule-management/rule_evolution.mdc` - Evolution guidelines
```

**Assessment**: All 4 rule management files are referenced correctly. However, the references could include key insights from each rule.

**Proposed Enhancement**:
```markdown
## Rule References

### Rule Management Standards (`.cursor/rules/08-rule-management/`)

| Rule | Purpose | Key Insight |
|------|---------|-------------|
| `rule_creation.mdc` | Rule creation standards | Use `**/*.ext` not `*.ext` for recursive matching |
| `rule_validation.mdc` | Validation procedures | Run 5-layer validation before every save |
| `glob_patterns.mdc` | Glob pattern guide | Test patterns with actual file counts |
| `rule_evolution.mdc` | Evolution guidelines | Create rule when same error occurs 3+ times |

### Critical Insights from Rules

1. **Root-only globs miss 95% of files** - Always use `**/*.ext` for recursive matching
2. **Rule type determined by field combinations** - Not by description or intent
3. **Apply Intelligently needs clear "when to use"** - Description must explain context
4. **Keep Always Apply rules to 6-7 maximum** - Avoid context pollution
5. **Always test glob patterns** - Verify actual file counts before deploying
```

---

### 7. Delegation Patterns (MEDIUM)

#### Issue 7.1: Delegation Section Incomplete

**Current** (Lines 165-175):
```markdown
## Delegation

This agent can delegate to:
- agent-auditor: For post-update validation
- documentation-master: For agent documentation

This agent is invoked by:
- meta-improvement-analyst: With improvement proposals
- agent-auditor: With update recommendations
- Manual: Agent maintenance requests
```

**Missing**:
- context-steward (MANDATORY for path validation)
- historian (MANDATORY for changelog entries)
- orchestrator (for workflow coordination)

**Proposed Fix**:
```markdown
## Delegation

### This agent MUST delegate to (MANDATORY):
- **context-steward**: Path validation BEFORE creating/updating files
- **historian**: Changelog entry AFTER completing work

### This agent can delegate to (OPTIONAL):
- **agent-auditor**: For post-update validation
- **documentation-master**: For user-facing documentation
- **code-reviewer**: For technical review of complex changes

### This agent is invoked by:
- **meta-improvement-analyst**: With improvement proposals
- **agent-auditor**: With update recommendations
- **orchestrator**: For system configuration workflows
- **Manual**: Agent/rule maintenance requests
```

---

## Proposed Changes

### Proposal 1: Update Role Section

**Location**: Lines 17-21

**Current**:
```markdown
# Agent Engineer

## Role

You are a system configuration engineer specializing in OpenCode agents, Cursor rules (`.cursor/rules/*.mdc`), custom modes (`.cursor/custom-modes/*.md`), and Orchestrator commands. You ensure technical precision, validated patterns, and production-ready system configuration. You implement improvements proposed by meta-improvement-analyst.

**Core Value**: Transform cursor rules/modes/agents from documentation into validated, tested, production-ready system configuration.
```

**Proposed**:
```markdown
# Rule Engineer

## Role

You are a comprehensive system configuration engineer specializing in:
- **OpenCode agents** (`.opencode/agent/*.md`)
- **Cursor agents** (`.cursor/agents/*.md`)
- **Cursor rules** (`.cursor/rules/**/*.mdc`)
- **AGENTS.md files** (root and directory-based)
- **Orchestrator commands** (`.opencode/command/*.md`)

You ensure technical precision, validated patterns, and production-ready system configuration. You implement improvements proposed by meta-improvement-analyst and maintain the agent/rule ecosystem.

**Core Value**: Transform system configuration from documentation into validated, tested, production-ready artifacts that prevent errors and guide AI assistants.

**Key Responsibilities**:
1. Create and maintain agents with proper structure and validation
2. Create and maintain rules with tested glob patterns
3. Maintain AGENTS.md files for tool-specific guidance
4. Ensure 5-layer validation on all changes
5. Document delegation patterns and integration points
```

---

### Proposal 2: Update Capabilities Section

**Location**: Lines 23-33

**Current**:
```markdown
## Capabilities

- OpenCode agent creation and updates
- Cursor rules creation and updates (`.cursor/rules/**/*.mdc`)
- Custom modes creation and updates (`.cursor/custom-modes/*.md`)
- Orchestrator agent/command updates (`.opencode/agent/orchestrator.md` and `.opencode/command/orchestrator.md`)
- AGENTS.md file maintenance
- 5-layer validation: YAML syntax, glob patterns, cross-references, size limits, duplication
- Tool configuration
- Delegation pattern design
- Integration configuration
```

**Proposed**:
```markdown
## Capabilities

### Agent Management
- **OpenCode agents**: Create/update agents at `.opencode/agent/*.md`
- **Cursor agents**: Create/update agents at `.cursor/agents/*.md`
- **Agent indexes**: Maintain `modes.json`, `COMPLETE_INDEX.md`, `README.md`
- **Orchestrator**: Update `.opencode/agent/orchestrator.md` and `.opencode/command/orchestrator.md`

### Rule Management
- **Cursor rules**: Create/update rules at `.cursor/rules/**/*.mdc`
- **Rule categories**: 00-core through 09-agents
- **Glob patterns**: Test and validate all patterns
- **Cross-references**: Validate all `mdc:` links

### AGENTS.md Management
- **Root AGENTS.md**: Project overview, build commands, code style, architecture
- **Directory AGENTS.md**: Feature-specific guidance for AI tools
- **Format standards**: Consistent structure across all AGENTS.md files

### Validation & Quality
- **5-layer validation**: YAML syntax, glob patterns, cross-references, size limits, duplication
- **Tool configuration**: Appropriate permissions for agent purpose
- **Delegation patterns**: Clear handoff documentation
- **Integration configuration**: MCP, Linear, governance hooks
```

---

### Proposal 3: Update Agent Locations Section

**Location**: Lines 177-209

**Current**:
```markdown
## Integration

### Agent Locations

All agents in `.opencode/agent/`:
- `governance/` - Governance agents
- `planning/` - Planning agents
- `implementation/` - Implementation agents
- `quality/` - Quality agents
- `specialized/` - Specialized agents

### Rule Locations

All rules in `.cursor/rules/`:
- `00-core/` - Core principles
- `01-architecture/` - Architecture patterns
- `02-data-models/` - Data modeling
- `03-security/` - Security patterns
- `04-standards/` - Code standards
- `05-quality/` - Quality assurance
- `06-workflow/` - Workflow patterns
- `08-rule-management/` - Rule management
- `09-custom-modes/` - Custom mode rules

### Custom Mode Locations

All custom modes in `.cursor/custom-modes/`:
- Individual mode files (`.md`)

### AGENTS.md Locations

AGENTS.md files throughout codebase:
- Root: `AGENTS.md` - Project overview
- Feature dirs: `{feature}/AGENTS.md` - Feature guidance
```

**Proposed**:
```markdown
## Integration

### Agent Locations

**OpenCode Agents** (FLAT structure - no subdirectories):
```
.opencode/agent/
├── orchestrator.md           # Entry point agent
├── context-steward.md        # Governance: path validation
├── historian.md              # Governance: audit trail
├── rule-engineer.md          # Governance: system config (this agent)
├── product-strategist.md     # Planning: requirements
├── strategic-architect.md    # Planning: architecture
├── linear-coordinator.md     # Planning: Linear integration
├── implementation-specialist.md  # Implementation: features
├── quick-fixer.md            # Implementation: hotfixes
├── code-reviewer.md          # Quality: reviews
├── test-engineer.md          # Quality: testing
├── ... (25 total agents)
└── registry.json             # Agent registry
```

**Cursor Agents** (FLAT structure):
```
.cursor/agents/
├── modes.json                # Agent configuration
├── COMPLETE_INDEX.md         # Full agent index
├── README.md                 # Overview
├── QUICK_START.md            # Getting started
├── FEATURE_WORKFLOW.md       # Workflow guide
├── WORKFLOW_PATTERNS.md      # Common patterns
├── product-strategist.md     # Individual agents...
├── strategic-architect.md
├── ... (21 agent files)
└── rule-engineer.md
```

**Logical Categories** (for documentation, NOT folder structure):
| Category | Agents | Purpose |
|----------|--------|---------|
| Governance | context-steward, historian, agent-auditor, meta-improvement-analyst, rule-engineer | Project organization, audit trail |
| Planning | product-strategist, strategic-architect, linear-coordinator | Requirements, architecture |
| Implementation | implementation-specialist, quick-fixer, devops-specialist | Code, deployment |
| Quality | code-reviewer, test-engineer, documentation-master, chat-auditor | Reviews, testing, docs |
| Specialized | rag-architect, ml-engineer, ai-engineer-agentic, project-guru, etc. | Domain expertise |

### Rule Locations

All rules in `.cursor/rules/` with category subfolders:
```
.cursor/rules/
├── 00-core/              # Fundamental principles (Always Apply)
├── 01-architecture/      # System design patterns
├── 02-data-models/       # Data modeling standards
├── 03-security/          # Security requirements
├── 04-standards/         # Coding conventions
├── 05-quality/           # Testing, performance
├── 06-workflow/          # Development process
├── 08-rule-management/   # Meta-rules (this agent's domain)
└── 09-agents/            # Agent-specific rules
```

### AGENTS.md Locations

**Root AGENTS.md** (`/AGENTS.md`):
- Project overview and purpose
- Build and test commands
- Code style guidelines
- Architecture notes
- Development workflow

**Directory AGENTS.md** (`{feature}/AGENTS.md`):
- Feature-specific guidance
- Local conventions
- Integration points
- Testing requirements
```

---

### Proposal 4: Add Comprehensive AGENTS.md Section

**Location**: Replace lines 118-130 with expanded section

**Proposed New Section**:
```markdown
### AGENTS.md Management

AGENTS.md files provide context for AI tools (Claude, Cursor, etc.) about specific directories or the entire project.

#### Root AGENTS.md Structure

The root `AGENTS.md` file should contain:

```markdown
# Agent Guidelines for {project-name}

## Build & Test Commands

\`\`\`bash
# Build
{build-command}

# Run tests (all)
{test-command}

# Run single test
{single-test-command}

# Lint
{lint-command}

# Format
{format-command}
\`\`\`

## Code Style

**Language**: {language} | **Version**: {version}

### Imports
- {import-organization-rules}

### Formatting & Naming
- {naming-conventions}

### Types & Errors
- {type-and-error-handling}

### Documentation
- {documentation-standards}

### Performance
- {performance-guidelines}

## Architecture Notes
- {architecture-overview}
- {key-modules}
- {data-flow}
```

#### Directory AGENTS.md Structure

Feature directories may have their own AGENTS.md:

```markdown
# {Feature} Guidelines

## Purpose
{what-this-directory-contains}

## Key Files
- `{file1}` - {purpose}
- `{file2}` - {purpose}

## Local Conventions
- {convention-1}
- {convention-2}

## Testing
- {testing-requirements}

## Integration Points
- {how-this-integrates-with-other-parts}
```

#### When to Create/Update AGENTS.md

**Create Root AGENTS.md when**:
- Starting a new project
- Build commands change
- Code style standards change
- Architecture significantly changes

**Create Directory AGENTS.md when**:
- Directory has complex or non-obvious structure
- Local conventions differ from project standards
- Feature requires specific testing approaches
- Integration points need documentation

**Update AGENTS.md when**:
- Commands change (new test framework, build tool)
- Conventions evolve (new patterns adopted)
- Architecture changes (new modules, refactoring)
- AI tools consistently make mistakes (add guidance)

#### AGENTS.md Validation

Before saving AGENTS.md changes:
1. **Verify commands work**: Run each command to confirm accuracy
2. **Check file references**: Ensure referenced files exist
3. **Test with AI**: Ask AI to perform task using the guidance
4. **Review for completeness**: All major areas covered
```

---

### Proposal 5: Enhance 5-Layer Validation Section

**Location**: Lines 88-117

**Proposed Enhancement** (expand to ~100 lines):
```markdown
### 5-Layer Validation (MANDATORY)

**CRITICAL**: All 5 layers MUST pass before saving any agent, rule, or AGENTS.md file.

#### Layer 1: YAML Syntax Validation

```markdown
VALIDATION STEPS:
1. Extract YAML frontmatter (content between first two `---` markers)
2. Parse as YAML (must succeed without errors)
3. Check for common errors:
   - Missing colons after keys
   - Incorrect boolean values (use `true`/`false`, not `True`/`False`)
   - Unquoted strings with special characters
   - Invalid list syntax

REQUIRED FIELDS BY TYPE:
- Agents: description, mode, model, tools
- Rules: description, globs (or alwaysApply: true)
- AGENTS.md: No frontmatter required (plain markdown)

SELF-CHECK:
□ YAML parses without errors?
□ All required fields present?
□ Field values are correct types?

IF validation fails → Fix and re-validate
```

#### Layer 2: Glob Pattern Testing (for rules)

```markdown
FOR EACH glob pattern:

1. Extract pattern from `globs:` field
2. Test with actual file search:
   - Use `glob` tool: glob('{pattern}')
   - Count matches

3. Validate match count:
   | Count | Status | Action |
   |-------|--------|--------|
   | 0 | ❌ CRITICAL | Pattern broken - fix before saving |
   | 1-5 | ⚠️ WARNING | Too specific? Verify intentional |
   | 6-200 | ✅ GOOD | Expected range |
   | 201-1000 | ⚠️ WARNING | Too broad? Consider narrowing |
   | >1000 | ❌ CRITICAL | Way too broad - narrow scope |

4. Check pattern syntax:
   - Root-only vs recursive: `src/*.py` vs `src/**/*.py`
   - File extensions correct?
   - Directory names accurate?

CRITICAL CHECKS:
□ Using `**/*.ext` for recursive matching? (NOT `*.ext`)
□ Pattern tested with actual glob tool?
□ Match count in expected range?
□ No quoted patterns? (globs: *.py NOT globs: "*.py")
```

#### Layer 3: Cross-Reference Validation

```markdown
FOR EACH mdc: link in content:

1. Extract link: `[text](mdc:path/to/file.mdc)`
2. Resolve path:
   - If starts with `../`: Calculate relative from current file
   - Otherwise: Same directory as current file
3. Verify target exists using `read` tool
4. Check link syntax is correct

SELF-CHECK:
□ All mdc: links resolve to existing files?
□ Target files are .mdc or .md files?
□ No circular references?

IF any link broken → Fix path or remove link
```

#### Layer 4: Size Limits

```markdown
CALCULATE: total_lines = count lines in file

THRESHOLDS:
| Type | Ideal | Acceptable | Requires Approval |
|------|-------|------------|-------------------|
| Rules | <300 | 300-500 | >500 |
| Agents | <400 | 400-800 | >800 |
| AGENTS.md | <200 | 200-400 | >400 |

IF exceeds acceptable:
1. ANALYZE content composition:
   - Examples: {percentage}%
   - Explanation: {percentage}%
   - Code samples: {percentage}%

2. RECOMMEND action:
   - Condense: Remove redundant examples
   - Split: Create multiple focused files
   - Refactor: Move examples to separate files

3. ASK USER for approval if proceeding with large file
```

#### Layer 5: Duplication Check

```markdown
SEARCH for similar content:

1. List related files:
   - For rules: Other rules in same category
   - For agents: Agents with similar purpose
   - For AGENTS.md: Other AGENTS.md files

2. Check for:
   - Duplicate functionality
   - Overlapping glob patterns (for rules)
   - Redundant instructions

3. DECISION:
   - Merge with existing file?
   - Create cross-reference instead?
   - Proceed with new file (justify why separate)?

SELF-CHECK:
□ Checked all related files?
□ No duplicate glob patterns?
□ No duplicate instructions?
□ Cross-references added where appropriate?
```

#### Validation Checklist Summary

```markdown
BEFORE SAVING, verify ALL pass:
- [ ] Layer 1: YAML frontmatter valid
- [ ] Layer 2: Glob patterns tested (rules only)
- [ ] Layer 3: Cross-references validated
- [ ] Layer 4: Size limits checked
- [ ] Layer 5: No duplication
- [ ] Required fields present
- [ ] Tools appropriate for purpose (agents)
- [ ] Instructions clear and actionable
- [ ] Guardrails explicit
- [ ] Delegation documented
- [ ] Context Steward integration (path validation)
- [ ] Historian integration (changelog entries)
```

---

### Proposal 6: Add Chain-of-Thought and Self-Reflection Patterns

**Location**: Add new section after Instructions (around line 155)

**Proposed New Section**:
```markdown
### Advanced Reasoning Patterns

#### Chain-of-Thought for Request Analysis

When receiving a request, explicitly reason through:

```markdown
REASONING CHAIN:

1. "User wants to: {restate request in own words}"
2. "This is a: {CREATE | UPDATE | FIX} operation"
3. "Target type: {AGENT | RULE | AGENTS.MD | COMMAND}"
4. "Target location: {specific file path}"
5. "Validation depth: {SYNTAX_ONLY | FULL_VALIDATION}"

CLASSIFICATION:
IF "create" OR "new" → TASK: CREATION
ELIF "update" OR "add" OR "enhance" → TASK: UPDATE
ELIF "fix" OR "broken" OR "error" → TASK: FIX
ELSE → ASK_USER for clarification

DETERMINE TARGET:
IF "rule" keyword → TARGET: CURSOR_RULE (.cursor/rules/)
ELIF "agent" keyword → TARGET: AGENT (.opencode/agent/ or .cursor/agents/)
ELIF "AGENTS.md" keyword → TARGET: AGENTS_MD
ELIF "orchestrator" OR "command" → TARGET: COMMAND
ELSE → INFER from file path or ask user
```

#### Self-Reflection Checkpoints

After each major step, reflect:

```markdown
SELF-REFLECTION (after reading current state):
"What am I changing and why?"
- Current state: {summary}
- Proposed change: {summary}
- Expected outcome: {summary}

SELF-REFLECTION (after designing changes):
"Does this change make sense?"
- Addresses user request? (Yes/No)
- Follows standards? (Yes/No)
- Introduces duplication? (Yes/No)
IF any "No" → Revise draft

SELF-REFLECTION (after validation):
"Is this production-ready?"
- All validations pass? (Yes/No)
- User request satisfied? (Yes/No)
- No regression? (Yes/No)
IF any "No" → Fix and re-validate
```

#### Debugging Patterns

**Pattern 1: Glob Pattern Not Matching**
```markdown
DEBUGGING CHAIN:
1. "What files should this match?" → List 3-5 example paths
2. "Does pattern cover these?" → Test each example
3. "Common mistakes:"
   - Missing **/ for recursive?
   - Wrong extension?
   - Typo in directory name?
4. "Test simpler pattern first" → Start broad, narrow down
5. "Verify with glob tool" → glob('{pattern}')
```

**Pattern 2: Validation Failure Recovery**
```markdown
RECOVERY PATTERN:
1. Identify failure layer (YAML? Glob? Cross-ref? Size? Duplication?)
2. For each failure:
   - ANALYZE: "Why did this fail?"
   - FIX: Apply correction
   - RE-VALIDATE: Run validation again
3. IF fix introduces new failure → ROLLBACK, try different approach
4. IF multiple attempts fail → DOCUMENT issue, ASK_USER for guidance
5. NEVER proceed with failed validation
```
```

---

## Implementation Recommendations

### Priority Order

| Phase | Changes | Estimated Effort | Dependencies |
|-------|---------|------------------|--------------|
| **Phase 1** | Proposals 1, 2, 3 (fix outdated references) | 30 min | None |
| **Phase 2** | Proposal 4 (AGENTS.md section) | 45 min | Phase 1 |
| **Phase 3** | Proposal 5 (5-layer validation) | 60 min | Phase 1 |
| **Phase 4** | Proposal 6 (reasoning patterns) | 45 min | Phase 3 |
| **Phase 5** | Update delegation section | 15 min | Phase 1 |
| **Phase 6** | Enhance rule references | 15 min | Phase 1 |

### Implementation Steps

1. **Read current file**: `.opencode/agent/rule-engineer.md`
2. **Apply Phase 1 changes**: Fix all outdated references
3. **Apply Phase 2 changes**: Add comprehensive AGENTS.md section
4. **Apply Phase 3 changes**: Expand 5-layer validation
5. **Apply Phase 4 changes**: Add reasoning patterns
6. **Apply Phase 5-6 changes**: Update delegation and references
7. **Run 5-layer validation** on the updated agent file
8. **Call Historian** to create changelog entry

### Estimated Final Size

Current: 217 lines
After updates: ~450-500 lines (reasonable for comprehensive agent)

---

## Validation Checklist for Updated Agent

After implementing changes, verify:

- [ ] No references to `.cursor/custom-modes/` (deprecated)
- [ ] Cursor agents at `.cursor/agents/*.md` documented
- [ ] OpenCode agents use flat structure (no subdirectories)
- [ ] AGENTS.md section is comprehensive (~80 lines)
- [ ] 5-layer validation is detailed (~100 lines)
- [ ] Chain-of-thought patterns included
- [ ] Self-reflection checkpoints included
- [ ] Delegation includes context-steward and historian
- [ ] All 4 rule management files referenced
- [ ] File size under 500 lines
- [ ] YAML frontmatter valid
- [ ] All cross-references resolve

---

## Trend Analysis

### Comparison with Reference Version

| Dimension | OpenCode (Current) | Cursor (Reference) | Gap |
|-----------|-------------------|-------------------|-----|
| Total Lines | 217 | 962 | 78% smaller |
| Role Definition | 5 lines | 25 lines | Missing depth |
| Capabilities | 9 items | 15+ items | Missing items |
| Validation Details | 30 lines | 150 lines | 80% less detail |
| Reasoning Patterns | 0 | 100+ lines | Completely missing |
| Examples | 0 | 50+ lines | Completely missing |
| Debugging Patterns | 0 | 100 lines | Completely missing |

### Quality Metrics

| Metric | Current Score | Target Score |
|--------|--------------|--------------|
| Accuracy (references) | 40% | 100% |
| Completeness | 45% | 90% |
| Actionability | 60% | 95% |
| Validation Coverage | 50% | 100% |
| Governance Integration | 70% | 100% |

---

## Appendix: File Inventory

### Files Audited

| File | Lines | Status |
|------|-------|--------|
| `.opencode/agent/rule-engineer.md` | 217 | Primary target |
| `.cursor/agents/rule-engineer.md` | 962 | Reference |
| `.cursor/rules/08-rule-management/rule_creation.mdc` | 374 | Reference |
| `.cursor/rules/08-rule-management/rule_validation.mdc` | 412 | Reference |
| `.cursor/rules/08-rule-management/glob_patterns.mdc` | 383 | Reference |
| `.cursor/rules/08-rule-management/rule_evolution.mdc` | 362 | Reference |
| `.cursor/rules/08-rule-management/README.md` | 44 | Reference |
| `AGENTS.md` | 63 | Reference |
| `.cursor/agents/modes.json` | 408 | Reference |
| `.cursor/agents/COMPLETE_INDEX.md` | 628 | Reference |

### Agent Locations Verified

| Location | Count | Structure |
|----------|-------|-----------|
| `.opencode/agent/` | 25 agents | Flat (correct) |
| `.cursor/agents/` | 21 agents + indexes | Flat (correct) |
| `.cursor/custom-modes/` | 0 files | Does not exist |

---

**Audit Completed**: 2025-12-16  
**Auditor**: Agent Auditor  
**Next Review**: Q1 2026 or after major rule changes

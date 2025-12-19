# Feature Specification: Phase 4B - Expanded Specialist Agents

**Feature ID**: `LIF-62-feat-multi-layered-orchestration-phase4b`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear Issue**: [LIF-62](https://linear.app/lifelogger/issue/LIF-62/multi-layered-agent-orchestration-enhancement-for-oh-my-opencode)  
**Branch**: `hello/lif-62-multi-layered-agent-orchestration-enhancement-for-oh-my`  
**Parent Spec**: [spec.md](./spec.md) (Phase 4A)

---

## Executive Summary

Expand Phase 4 of LIF-62 with additional specialist agents covering diverse technology domains and cross-cutting concerns. This phase adds 9 new specialist agents organized into three categories:

1. **Language/Platform Specialists** (4 agents): Rust, Python, iOS/Xcode, React Native
2. **AI/ML Specialists** (2 agents): AI/ML Expert, Agent Specialist
3. **Cross-Cutting Specialists** (3 agents): Security, Testing, Optimization

All new agents follow the established Phase 4A patterns:
- **Role**: Specialist (cannot delegate, terminal nodes)
- **Governance**: Full (path validation, changelog, Linear integration)
- **Response Format**: Structured JSON handoff

### Expanded Agent Hierarchy (Post-Phase 4B)

```
OmO (team-lead, Claude Opus)
├── implementation-specialist (manager, Claude Sonnet) ← DELEGATES TO ALL SPECIALISTS
│   │
│   │   # Phase 4A Specialists (Complete)
│   ├── backend-typescript (specialist, Claude Sonnet)
│   ├── frontend-react (specialist, Gemini Pro)
│   ├── frontend-ui-ux-engineer (specialist, Gemini Pro)
│   └── document-writer (specialist, Gemini Pro)
│   │
│   │   # Phase 4B: Language/Platform Specialists (NEW)
│   ├── backend-rust (specialist, Claude Sonnet)
│   ├── backend-python (specialist, Claude Sonnet)
│   ├── mobile-xcode (specialist, Gemini Pro)
│   └── mobile-react-native (specialist, Gemini Pro)
│   │
│   │   # Phase 4B: AI/ML Specialists (NEW)
│   ├── ai-ml-expert (specialist, Claude Opus)
│   └── agent-specialist (specialist, Claude Opus)
│   │
│   │   # Phase 4B: Cross-Cutting Specialists (NEW)
│   ├── security-specialist (specialist, GPT-5.2)
│   ├── test-specialist (specialist, Claude Sonnet)
│   └── optimization-specialist (specialist, Claude Sonnet)
│
├── oracle (advisor, GPT-5.2) - read-only
├── librarian (utility, Claude Sonnet) - read-only
├── explore (utility, Grok) - read-only
└── multimodal-looker (utility, Gemini Flash) - read-only
```

---

## User Scenarios & Testing *(mandatory)*

### Category A: Language/Platform Specialists

---

#### User Story 7 - Rust Backend Implementation (Priority: P1)

As a developer using OMO, when I need to implement high-performance backend services in Rust, I want the Implementation Specialist to delegate to a Rust-specialized agent so that I get idiomatic, safe, and performant Rust code.

**Why this priority**: Rust is increasingly adopted for performance-critical backend services, WebAssembly modules, and systems programming. Many modern projects use Rust alongside TypeScript.

**Independent Test**: Request "implement a rate limiter service in Rust" and verify:
1. OmO delegates to Implementation Specialist
2. Implementation Specialist delegates to `backend-rust`
3. Generated code follows Rust idioms (ownership, borrowing, Result types)
4. Structured response includes file changes and compilation status

**Acceptance Scenarios**:

1. **Given** a user requests a Rust backend service, **When** Implementation Specialist analyzes the task, **Then** it delegates to `backend-rust` (not `backend-typescript`)
2. **Given** `backend-rust` implements a module, **When** it completes, **Then** the code compiles without errors (`cargo check` passes)
3. **Given** `backend-rust` creates files, **When** the session ends, **Then** governance hooks track the changes (changelog, path validation)

---

#### User Story 8 - Python Backend Implementation (Priority: P1)

As a developer using OMO, when I need to implement Python backend services (FastAPI, Django, Flask), data pipelines, or ML inference endpoints, I want the Implementation Specialist to delegate to a Python-specialized agent so that I get Pythonic, type-hinted, well-structured code.

**Why this priority**: Python is the dominant language for AI/ML, data processing, and many backend services. Essential for projects with ML components.

**Independent Test**: Request "create a FastAPI endpoint for user authentication" and verify:
1. Implementation Specialist delegates to `backend-python`
2. Code uses type hints, follows PEP 8, uses modern Python patterns
3. Appropriate dependencies are identified (FastAPI, Pydantic)

**Acceptance Scenarios**:

1. **Given** a user requests a Python API, **When** Implementation Specialist identifies Python requirements, **Then** it delegates to `backend-python`
2. **Given** `backend-python` generates code, **When** reviewed, **Then** it includes type hints and follows PEP 8
3. **Given** the task requires ML inference, **When** `backend-python` implements it, **Then** it uses appropriate libraries (PyTorch, TensorFlow, scikit-learn)

---

#### User Story 9 - iOS/macOS Development (Priority: P2)

As a developer using OMO, when I need to implement iOS or macOS applications, I want the Implementation Specialist to delegate to an Xcode-specialized agent so that I get Swift code following Apple's Human Interface Guidelines and modern SwiftUI patterns.

**Why this priority**: Apple platform development requires specialized knowledge of SwiftUI, UIKit, Combine, and Apple's ecosystem conventions.

**Independent Test**: Request "create a settings screen with toggle preferences in SwiftUI" and verify:
1. Implementation Specialist delegates to `mobile-xcode`
2. Code uses SwiftUI best practices
3. Follows Apple HIG conventions

**Acceptance Scenarios**:

1. **Given** a user requests iOS UI work, **When** Implementation Specialist identifies the platform, **Then** it delegates to `mobile-xcode`
2. **Given** `mobile-xcode` creates SwiftUI views, **When** reviewed, **Then** they follow Apple's declarative patterns
3. **Given** the task involves Core Data or CloudKit, **When** `mobile-xcode` implements it, **Then** it uses appropriate Apple frameworks

---

#### User Story 10 - React Native Mobile Development (Priority: P2)

As a developer using OMO, when I need to implement cross-platform mobile applications, I want the Implementation Specialist to delegate to a React Native specialist so that I get code that works on both iOS and Android with native performance.

**Why this priority**: React Native enables code sharing between platforms while maintaining native UX. Common choice for startups and rapid mobile development.

**Independent Test**: Request "create a bottom tab navigation with three screens" and verify:
1. Implementation Specialist delegates to `mobile-react-native`
2. Code uses React Navigation patterns
3. Platform-specific code is properly handled

**Acceptance Scenarios**:

1. **Given** a user requests React Native work, **When** Implementation Specialist identifies cross-platform mobile needs, **Then** it delegates to `mobile-react-native`
2. **Given** `mobile-react-native` creates components, **When** reviewed, **Then** they follow React Native best practices
3. **Given** the task requires native modules, **When** `mobile-react-native` implements it, **Then** it provides proper bridging code

---

### Category B: AI/ML Specialists

---

#### User Story 11 - AI/ML Implementation (Priority: P1)

As a developer using OMO, when I need to implement AI/ML features (model integration, prompt engineering, RAG systems, agentic workflows), I want the Implementation Specialist to delegate to an AI/ML expert so that I get code following best practices from current AI research and frameworks like DSPy, Agno, LangChain.

**Why this priority**: AI/ML implementation requires understanding of LLM patterns, prompt optimization, vector databases, and agentic architectures. This is core to modern AI-powered applications.

**Reference Research**: Based on "Fundamentals of Building Autonomous LLM Agents" (arXiv:2510.09244):
- **Perception Systems**: Environmental understanding and input processing
- **Reasoning Systems**: Chain-of-Thought, Tree-of-Thought, ReAct patterns
- **Memory Systems**: Short-term (context window), long-term (vector stores)
- **Execution Systems**: Tool calling, action translation, feedback loops

**Independent Test**: Request "implement a RAG pipeline with semantic search" and verify:
1. Implementation Specialist delegates to `ai-ml-expert`
2. Code uses appropriate embedding models and vector stores
3. Implements proper chunking and retrieval strategies

**Acceptance Scenarios**:

1. **Given** a user requests RAG implementation, **When** Implementation Specialist identifies AI/ML requirements, **Then** it delegates to `ai-ml-expert`
2. **Given** `ai-ml-expert` implements prompt optimization, **When** reviewed, **Then** it uses DSPy patterns (Signatures, Modules, Optimizers)
3. **Given** the task involves agentic workflows, **When** `ai-ml-expert` implements it, **Then** it follows patterns from Agno/LangChain (perception, reasoning, memory, execution)
4. **Given** `ai-ml-expert` creates LLM integrations, **When** reviewed, **Then** it includes proper error handling, retries, and token management

---

#### User Story 12 - Agent Design and Orchestration (Priority: P1)

As a developer using OMO, when I need to design multi-agent systems, orchestration patterns, or extend OMO itself, I want the Implementation Specialist to delegate to an agent specialist so that I get architecturally sound agent designs following proven patterns.

**Why this priority**: Meta-agent design (designing agents that work with agents) requires deep understanding of delegation patterns, context management, and orchestration. Essential for extending OMO.

**Independent Test**: Request "design a research agent team with coordinator and specialists" and verify:
1. Implementation Specialist delegates to `agent-specialist`
2. Design follows multi-layered orchestration patterns
3. Includes proper delegation protocols and response formats

**Acceptance Scenarios**:

1. **Given** a user requests agent architecture work, **When** Implementation Specialist identifies meta-agent needs, **Then** it delegates to `agent-specialist`
2. **Given** `agent-specialist` designs an agent hierarchy, **When** reviewed, **Then** it follows OMO's role-based patterns (team-lead, manager, specialist)
3. **Given** the task involves agent prompts, **When** `agent-specialist` creates them, **Then** they include proper constraints, delegation rules, and response formats
4. **Given** `agent-specialist` designs orchestration, **When** reviewed, **Then** it considers context window limits, delegation depth, and loop prevention

---

### Category C: Cross-Cutting Specialists

---

#### User Story 13 - Security Analysis and Implementation (Priority: P2)

As a developer using OMO, when I need security audits, vulnerability analysis, or security-focused implementation, I want the Implementation Specialist to delegate to a security specialist so that I get technology-agnostic security guidance and secure code patterns.

**Why this priority**: Security is a cross-cutting concern that applies to all technology stacks. A dedicated specialist can identify vulnerabilities that domain specialists might miss.

**Independent Test**: Request "audit this authentication flow for security vulnerabilities" and verify:
1. Implementation Specialist delegates to `security-specialist`
2. Analysis covers OWASP Top 10 relevant issues
3. Provides actionable remediation recommendations

**Acceptance Scenarios**:

1. **Given** a user requests security review, **When** Implementation Specialist identifies security focus, **Then** it delegates to `security-specialist`
2. **Given** `security-specialist` audits code, **When** it finds vulnerabilities, **Then** it provides severity ratings and remediation steps
3. **Given** the task involves implementing auth, **When** `security-specialist` provides guidance, **Then** it follows OWASP best practices
4. **Given** any technology stack, **When** `security-specialist` analyzes it, **Then** it adapts its analysis to that technology's security patterns

---

#### User Story 14 - Testing Strategy and Implementation (Priority: P2)

As a developer using OMO, when I need comprehensive testing (unit, integration, e2e, performance), I want the Implementation Specialist to delegate to a test specialist so that I get well-structured tests following testing best practices for any technology.

**Why this priority**: Testing is essential for code quality but often overlooked. A dedicated specialist ensures proper test coverage, patterns, and tooling regardless of the implementation language.

**Independent Test**: Request "create unit tests for this user service" and verify:
1. Implementation Specialist delegates to `test-specialist`
2. Tests cover happy paths, edge cases, and error conditions
3. Uses appropriate testing framework for the language

**Acceptance Scenarios**:

1. **Given** a user requests test creation, **When** Implementation Specialist identifies testing needs, **Then** it delegates to `test-specialist`
2. **Given** `test-specialist` creates tests, **When** reviewed, **Then** they follow AAA pattern (Arrange, Act, Assert)
3. **Given** TypeScript code, **When** `test-specialist` creates tests, **Then** it uses Vitest/Jest with proper mocking
4. **Given** Python code, **When** `test-specialist` creates tests, **Then** it uses pytest with fixtures
5. **Given** Rust code, **When** `test-specialist` creates tests, **Then** it uses built-in test framework with proper assertions

---

#### User Story 15 - Performance Optimization (Priority: P2)

As a developer using OMO, when I need performance analysis, profiling guidance, or optimization implementation, I want the Implementation Specialist to delegate to an optimization specialist so that I get technology-appropriate performance improvements.

**Why this priority**: Performance optimization requires understanding of profiling, bottleneck identification, and language-specific optimization patterns. A dedicated specialist can provide focused expertise.

**Independent Test**: Request "optimize this database query for better performance" and verify:
1. Implementation Specialist delegates to `optimization-specialist`
2. Analysis identifies specific bottlenecks
3. Provides measurable optimization recommendations

**Acceptance Scenarios**:

1. **Given** a user requests performance optimization, **When** Implementation Specialist identifies optimization needs, **Then** it delegates to `optimization-specialist`
2. **Given** `optimization-specialist` analyzes code, **When** it finds bottlenecks, **Then** it provides specific optimization strategies
3. **Given** database queries, **When** `optimization-specialist` optimizes them, **Then** it considers indexing, query plans, and N+1 issues
4. **Given** frontend code, **When** `optimization-specialist` optimizes it, **Then** it considers bundle size, rendering performance, and caching
5. **Given** backend code, **When** `optimization-specialist` optimizes it, **Then** it considers async patterns, connection pooling, and memory usage

---

### Edge Cases

- **What happens when** a task spans multiple specialist domains (e.g., Python + AI/ML)? Implementation Specialist should delegate to the most specific specialist (`ai-ml-expert` for AI tasks even if Python is involved).
- **What happens when** the codebase technology isn't detected automatically? Cross-cutting specialists (security, testing, optimization) should ask for technology context or infer from file extensions.
- **What happens when** a specific specialist is unavailable? Implementation Specialist should fall back to the most similar available specialist or handle directly.
- **What happens when** cross-cutting work requires code changes? Security/test/optimization specialists CAN modify files (they have write access) but should focus on their domain.
- **How does the system handle** technology detection for generic agents? Use file extensions, package.json/Cargo.toml/pyproject.toml, and explicit user context.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Language/Platform Specialists

- **FR-101**: System MUST provide a `backend-rust` specialist agent for Rust backend development
- **FR-102**: `backend-rust` MUST understand Rust ownership, borrowing, lifetimes, and async patterns
- **FR-103**: `backend-rust` MUST generate code that compiles with `cargo check`
- **FR-104**: System MUST provide a `backend-python` specialist agent for Python backend development
- **FR-105**: `backend-python` MUST generate type-hinted code following PEP 8
- **FR-106**: `backend-python` MUST understand FastAPI, Django, Flask, and data processing libraries
- **FR-107**: System MUST provide a `mobile-xcode` specialist agent for iOS/macOS development
- **FR-108**: `mobile-xcode` MUST understand SwiftUI, UIKit, Combine, and Apple frameworks
- **FR-109**: `mobile-xcode` MUST follow Apple Human Interface Guidelines
- **FR-110**: System MUST provide a `mobile-react-native` specialist agent for cross-platform mobile
- **FR-111**: `mobile-react-native` MUST understand React Navigation, native modules, and platform-specific code

#### AI/ML Specialists

- **FR-112**: System MUST provide an `ai-ml-expert` specialist agent for AI/ML implementation
- **FR-113**: `ai-ml-expert` MUST understand DSPy patterns (Signatures, Modules, Optimizers, Teleprompters)
- **FR-114**: `ai-ml-expert` MUST understand Agno framework patterns (Agent, Team, Tools, Memory)
- **FR-115**: `ai-ml-expert` MUST understand agentic architectures (perception, reasoning, memory, execution)
- **FR-116**: `ai-ml-expert` MUST understand RAG patterns (chunking, embedding, retrieval, generation)
- **FR-117**: `ai-ml-expert` MUST understand LLM integration patterns (streaming, retries, token management)
- **FR-118**: System MUST provide an `agent-specialist` for meta-agent design and orchestration
- **FR-119**: `agent-specialist` MUST understand OMO's multi-layered orchestration patterns
- **FR-120**: `agent-specialist` MUST understand delegation protocols and response formats
- **FR-121**: `agent-specialist` MUST understand context window management and delegation depth limits

#### Cross-Cutting Specialists

- **FR-122**: System MUST provide a `security-specialist` for security analysis and implementation
- **FR-123**: `security-specialist` MUST be technology-agnostic (works with any codebase)
- **FR-124**: `security-specialist` MUST understand OWASP Top 10 and common vulnerability patterns
- **FR-125**: `security-specialist` MUST provide severity ratings and remediation guidance
- **FR-126**: System MUST provide a `test-specialist` for testing strategy and implementation
- **FR-127**: `test-specialist` MUST be technology-agnostic (adapts to project's test framework)
- **FR-128**: `test-specialist` MUST understand unit, integration, e2e, and performance testing
- **FR-129**: `test-specialist` MUST generate tests following AAA pattern
- **FR-130**: System MUST provide an `optimization-specialist` for performance optimization
- **FR-131**: `optimization-specialist` MUST be technology-agnostic
- **FR-132**: `optimization-specialist` MUST understand profiling, bottleneck identification, and optimization patterns

#### Common Requirements

- **FR-133**: All Phase 4B specialists MUST be terminal nodes (cannot delegate further)
- **FR-134**: All Phase 4B specialists MUST have governance awareness (full level)
- **FR-135**: All Phase 4B specialists MUST return structured JSON responses
- **FR-136**: All Phase 4B specialists MUST be delegatable from `implementation-specialist`
- **FR-137**: Implementation Specialist MUST be updated to recognize and delegate to new specialists

### Non-Functional Requirements

- **NFR-101**: Each new specialist prompt MUST NOT exceed 3000 tokens
- **NFR-102**: Specialist agent files MUST follow existing patterns in `src/agents/`
- **NFR-103**: All specialists MUST be registered in `src/agents/index.ts`
- **NFR-104**: Phase 4B changes MUST NOT break existing Phase 4A functionality
- **NFR-105**: Cross-cutting specialists MUST adapt to detected technology within 1 interaction

### Key Entities

- **Language Specialist**: Agent specialized in a specific programming language/platform (Rust, Python, Swift, React Native)
- **AI/ML Specialist**: Agent specialized in AI/ML implementation patterns and frameworks
- **Cross-Cutting Specialist**: Technology-agnostic agent focused on a specific concern (security, testing, optimization)
- **Technology Detection**: Process of identifying the project's technology stack from files and configuration

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: All 9 new specialist agents are registered and invocable
- **SC-102**: Implementation Specialist successfully delegates to appropriate specialist for each domain
- **SC-103**: Cross-cutting specialists (security, testing, optimization) work with at least 3 different technology stacks
- **SC-104**: All specialists return valid structured JSON responses
- **SC-105**: All specialists have governance awareness (verified via prompt inspection)
- **SC-106**: No breaking changes to Phase 4A agents (backend-typescript, frontend-react still work)
- **SC-107**: `ai-ml-expert` successfully implements a RAG pipeline following DSPy/Agno patterns
- **SC-108**: `agent-specialist` successfully designs a multi-agent system following OMO patterns

---

## Model Selection Rationale

Following Constitution Principle II (Multi-Model Excellence), each specialist uses the optimal model for its domain:

| Agent | Model | Rationale |
|-------|-------|-----------|
| `backend-rust` | `anthropic/claude-sonnet-4-5` | Claude excels at systems programming, memory safety reasoning, and Rust's complex type system |
| `backend-python` | `anthropic/claude-sonnet-4-5` | Strong Python code generation, understands ML libraries and type hints |
| `mobile-xcode` | `google/gemini-3-pro-preview` | Gemini excels at UI/visual understanding, important for Apple HIG compliance |
| `mobile-react-native` | `google/gemini-3-pro-preview` | Consistent with frontend-react, good at component-based UI patterns |
| `ai-ml-expert` | `anthropic/claude-opus-4-5` | **Opus required** for complex AI reasoning, understanding research papers, and meta-cognitive patterns |
| `agent-specialist` | `anthropic/claude-opus-4-5` | **Opus required** for meta-agent design, requires deep understanding of agent architectures |
| `security-specialist` | `openai/gpt-5.2` | GPT-5.2 excels at strategic analysis, threat modeling, and systematic vulnerability assessment |
| `test-specialist` | `anthropic/claude-sonnet-4-5` | Claude Sonnet is excellent at code generation and understanding test patterns |
| `optimization-specialist` | `anthropic/claude-sonnet-4-5` | Strong at analyzing code patterns and suggesting optimizations |

### Model Cost Considerations

- **Opus agents** (`ai-ml-expert`, `agent-specialist`): Use sparingly, only for complex AI/agent tasks
- **Sonnet agents**: Default for most implementation work, good balance of capability and cost
- **Gemini agents**: Preferred for UI/visual work, competitive pricing
- **GPT-5.2 agents**: Strategic analysis tasks, used for security due to systematic reasoning

---

## Tool Permissions by Specialist

All Phase 4B specialists follow the `specialist` role configuration:

```typescript
// Common tool configuration for all Phase 4B specialists
{
  // Specialist role: TERMINAL - Cannot delegate
  task: false,
  background_task: false,
  call_omo_agent: false,
  
  // File tools: enabled with governance
  write: true,
  edit: true,
  
  // Read/search tools
  read: true,
  glob: true,
  grep: true,
  
  // Governance tools (limited)
  linear_branch: true,
  linear_update_status: true,
  linear_create_issue: false,  // Only team-lead creates issues
  create_spec_folder: false,   // Only team-lead creates specs
  read_context: true,
}
```

### Special Tool Considerations

| Agent | Additional Tools | Rationale |
|-------|------------------|-----------|
| `ai-ml-expert` | MCP access (context7, websearch) | May need to look up latest AI/ML documentation |
| `security-specialist` | Read-heavy (grep, glob, read) | Security analysis requires extensive code reading |
| `test-specialist` | Standard file tools | Needs to create test files alongside source |
| `optimization-specialist` | Read-heavy | Performance analysis requires understanding existing code |

---

## Implementation Specialist Update

The `implementation-specialist` agent MUST be updated to recognize and delegate to new specialists:

### Updated Delegation Logic

```markdown
## DELEGATION AUTHORITY (Updated for Phase 4B)

You CAN delegate to:

### Language/Platform Specialists
- `backend-typescript`: TypeScript/Node.js backend (APIs, services, database)
- `backend-rust`: Rust backend (systems, performance-critical services, WebAssembly)
- `backend-python`: Python backend (FastAPI, Django, Flask, data pipelines, ML inference)
- `frontend-react`: React/Next.js frontend (components, hooks, state)
- `frontend-ui-ux-engineer`: Design-focused UI work (aesthetics, animations)
- `mobile-xcode`: iOS/macOS development (Swift, SwiftUI, UIKit)
- `mobile-react-native`: Cross-platform mobile (React Native, Expo)
- `document-writer`: Technical documentation

### AI/ML Specialists
- `ai-ml-expert`: AI/ML implementation (RAG, prompt engineering, LLM integration, DSPy, Agno)
- `agent-specialist`: Agent design and orchestration (multi-agent systems, OMO extensions)

### Cross-Cutting Specialists
- `security-specialist`: Security audits, vulnerability analysis, secure coding
- `test-specialist`: Test creation (unit, integration, e2e), testing strategy
- `optimization-specialist`: Performance analysis, profiling, optimization

## DELEGATION DECISION TREE

1. **Is this AI/ML work?** → Delegate to `ai-ml-expert`
2. **Is this agent/orchestration design?** → Delegate to `agent-specialist`
3. **Is this security-focused?** → Delegate to `security-specialist`
4. **Is this testing work?** → Delegate to `test-specialist`
5. **Is this optimization work?** → Delegate to `optimization-specialist`
6. **What language/platform?**
   - Rust → `backend-rust`
   - Python → `backend-python`
   - TypeScript backend → `backend-typescript`
   - React/Next.js → `frontend-react`
   - Swift/iOS/macOS → `mobile-xcode`
   - React Native → `mobile-react-native`
   - Design-focused UI → `frontend-ui-ux-engineer`
   - Documentation → `document-writer`
```

---

## Technical Context

### New Files to Create

| File | Purpose | Est. LOC |
|------|---------|----------|
| `src/agents/backend-rust.ts` | Rust backend specialist | ~200 |
| `src/agents/backend-python.ts` | Python backend specialist | ~200 |
| `src/agents/mobile-xcode.ts` | iOS/macOS specialist | ~220 |
| `src/agents/mobile-react-native.ts` | React Native specialist | ~200 |
| `src/agents/ai-ml-expert.ts` | AI/ML implementation specialist | ~350 |
| `src/agents/agent-specialist.ts` | Agent design specialist | ~300 |
| `src/agents/security-specialist.ts` | Security specialist | ~250 |
| `src/agents/test-specialist.ts` | Testing specialist | ~250 |
| `src/agents/optimization-specialist.ts` | Optimization specialist | ~230 |

### Files to Modify

| File | Changes |
|------|---------|
| `src/agents/types.ts` | Add new agent names to `BuiltinAgentName` union |
| `src/agents/index.ts` | Import and register new agents, update `AGENT_ROLE_REGISTRY` |
| `src/tools/call-omo-agent/constants.ts` | Add new agents to `ALLOWED_AGENTS` |
| `src/agents/implementation-specialist.ts` | Update delegation logic and available specialists |

### Type Updates

```typescript
// src/agents/types.ts - Add to BuiltinAgentName
export type BuiltinAgentName =
  | "OmO"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"
  // Phase 4A
  | "implementation-specialist"
  | "backend-typescript"
  | "frontend-react"
  // Phase 4B: Language/Platform Specialists
  | "backend-rust"
  | "backend-python"
  | "mobile-xcode"
  | "mobile-react-native"
  // Phase 4B: AI/ML Specialists
  | "ai-ml-expert"
  | "agent-specialist"
  // Phase 4B: Cross-Cutting Specialists
  | "security-specialist"
  | "test-specialist"
  | "optimization-specialist"
```

---

## AI/ML Expert Knowledge Base

The `ai-ml-expert` agent should understand these frameworks and concepts:

### DSPy Framework

```python
# DSPy Core Concepts
from dspy import Signature, Module, ChainOfThought, BootstrapFewShot

# Signatures define input/output structure
class RAGSignature(Signature):
    """Answer questions using retrieved context."""
    context: str
    question: str
    answer: str

# Modules compose LLM calls
class RAGModule(Module):
    def __init__(self):
        self.retrieve = dspy.Retrieve(k=3)
        self.generate = ChainOfThought(RAGSignature)
    
    def forward(self, question):
        context = self.retrieve(question)
        return self.generate(context=context, question=question)

# Optimizers tune prompts automatically
optimizer = BootstrapFewShot(metric=accuracy, max_bootstrapped_demos=4)
optimized = optimizer.compile(RAGModule(), trainset=examples)
```

### Agno Framework

```python
# Agno Core Concepts
from agno.agent import Agent
from agno.models.anthropic import Claude
from agno.tools.reasoning import ReasoningTools
from agno.team import Team

# Single agent with tools
agent = Agent(
    model=Claude(id="claude-3-7-sonnet-latest"),
    tools=[ReasoningTools(add_instructions=True)],
    instructions=["Use tables to display data"],
    markdown=True,
)

# Multi-agent team
team = Team(
    agents=[research_agent, analysis_agent],
    model=Claude(id="claude-3-7-sonnet-latest"),
)
```

### Agentic Architecture (arXiv:2510.09244)

1. **Perception System**: Converts environmental inputs into meaningful representations
2. **Reasoning System**: Chain-of-Thought, Tree-of-Thought, ReAct patterns
3. **Memory System**: 
   - Short-term: Context window, conversation history
   - Long-term: Vector stores, knowledge bases
4. **Execution System**: Tool calling, action translation, feedback loops

---

## Cross-Cutting Specialist Adaptation

Cross-cutting specialists must adapt to the detected technology:

### Technology Detection Strategy

```typescript
// Pseudo-code for technology detection
function detectTechnology(context: TaskContext): TechnologyStack {
  // 1. Check explicit user mention
  if (context.userMentions.includes("rust")) return "rust"
  if (context.userMentions.includes("python")) return "python"
  
  // 2. Check file extensions in scope
  const extensions = context.relevantFiles.map(f => getExtension(f))
  if (extensions.includes(".rs")) return "rust"
  if (extensions.includes(".py")) return "python"
  if (extensions.includes(".ts")) return "typescript"
  if (extensions.includes(".swift")) return "swift"
  
  // 3. Check config files
  if (context.hasFile("Cargo.toml")) return "rust"
  if (context.hasFile("pyproject.toml")) return "python"
  if (context.hasFile("package.json")) return "typescript"
  if (context.hasFile("Package.swift")) return "swift"
  
  // 4. Ask for clarification
  return "unknown"
}
```

### Adaptation Examples

**Security Specialist** adapts:
- **TypeScript**: Check for SQL injection, XSS, insecure dependencies (npm audit)
- **Python**: Check for SQL injection, command injection, insecure deserialization
- **Rust**: Check for unsafe blocks, memory issues, dependency vulnerabilities

**Test Specialist** adapts:
- **TypeScript**: Use Vitest/Jest, mock with vi/jest.mock
- **Python**: Use pytest, fixtures, parametrize
- **Rust**: Use built-in test framework, #[cfg(test)] modules

**Optimization Specialist** adapts:
- **TypeScript**: Bundle analysis, tree shaking, lazy loading
- **Python**: Profiling with cProfile, async optimization, NumPy vectorization
- **Rust**: Cargo flamegraph, zero-copy patterns, SIMD

---

## Assumptions

1. **Model Availability**: Assumes Claude Opus, GPT-5.2, and Gemini Pro are available for all users
2. **Framework Knowledge**: Assumes DSPy and Agno frameworks remain stable; prompts may need updates if APIs change
3. **Technology Detection**: Assumes projects have standard config files (package.json, Cargo.toml, etc.)
4. **Governance Hooks**: Assumes existing governance hooks work for all new specialists without modification
5. **Implementation Specialist Capacity**: Assumes Implementation Specialist can handle increased delegation options

---

## Out of Scope

- **Language specialists for**: Go, Java, C++, C#, Ruby (future enhancement)
- **Platform specialists for**: Android native (Kotlin), Flutter, Electron (future enhancement)
- **Additional AI frameworks**: LangChain, LlamaIndex, AutoGen (can be added to ai-ml-expert later)
- **Automated technology detection tool**: Manual detection via file inspection for now
- **Specialist-to-specialist communication**: All communication goes through Implementation Specialist

---

## Related Issues

- [LIF-62](https://linear.app/lifelogger/issue/LIF-62): Multi-Layered Agent Orchestration Enhancement (parent)
- Phase 4A: Foundation specialists (backend-typescript, frontend-react) - Complete

---

## Implementation Phases

### Phase 4B.1: Language/Platform Specialists (Est: 16h)

1. Create `backend-rust.ts` (4h)
2. Create `backend-python.ts` (4h)
3. Create `mobile-xcode.ts` (4h)
4. Create `mobile-react-native.ts` (4h)

### Phase 4B.2: AI/ML Specialists (Est: 14h)

1. Create `ai-ml-expert.ts` with DSPy/Agno/agentic knowledge (8h)
2. Create `agent-specialist.ts` with OMO patterns (6h)

### Phase 4B.3: Cross-Cutting Specialists (Est: 12h)

1. Create `security-specialist.ts` (4h)
2. Create `test-specialist.ts` (4h)
3. Create `optimization-specialist.ts` (4h)

### Phase 4B.4: Integration (Est: 8h)

1. Update `src/agents/types.ts` with new agent names (1h)
2. Update `src/agents/index.ts` with imports and registry (2h)
3. Update `src/tools/call-omo-agent/constants.ts` (1h)
4. Update `implementation-specialist.ts` delegation logic (2h)
5. Integration testing (2h)

### Total Estimated: 50h

---

## Appendix A: Agent Prompt Templates

### Backend Rust Specialist Prompt Structure

```markdown
<role>
You are the BACKEND RUST SPECIALIST - an expert in Rust systems programming with deep knowledge of ownership, borrowing, async/await, and the Rust ecosystem.

## CORE MISSION
Execute Rust backend implementation tasks delegated by Implementation Specialist. Deliver safe, performant, idiomatic Rust code.

## EXPERTISE AREAS
- Memory safety (ownership, borrowing, lifetimes)
- Async Rust (tokio, async-std)
- Web frameworks (Actix-web, Axum, Rocket)
- Serialization (serde, bincode)
- Error handling (Result, thiserror, anyhow)
- Database (sqlx, diesel, sea-orm)
- Testing (built-in test framework, proptest)

## CODE PATTERNS
[Rust-specific patterns for services, error handling, async]

## STRUCTURED RESPONSE FORMAT
[Standard JSON response format]
</role>

<constraints>
- You are a SPECIALIST. You CANNOT delegate.
- All code MUST compile with `cargo check`
- Follow Rust idioms (no unwrap in production code)
- Use Result types for error handling
</constraints>
```

### AI/ML Expert Prompt Structure

```markdown
<role>
You are the AI/ML EXPERT - a specialist in AI/ML implementation with deep knowledge of LLM patterns, prompt engineering, RAG systems, and agentic frameworks.

## CORE MISSION
Execute AI/ML implementation tasks delegated by Implementation Specialist. Deliver production-ready AI integrations following best practices from current research.

## EXPERTISE AREAS

### Prompt Engineering & Optimization
- DSPy framework (Signatures, Modules, Optimizers, Teleprompters)
- Few-shot learning and example selection
- Chain-of-Thought, Tree-of-Thought reasoning
- Prompt templating and variable injection

### Agentic Frameworks
- Agno (Agent, Team, Tools, Memory patterns)
- LangChain/LangGraph patterns
- ReAct (Reasoning + Acting) pattern
- Multi-agent orchestration

### RAG Systems
- Document chunking strategies
- Embedding models (OpenAI, Cohere, local)
- Vector stores (Pinecone, Weaviate, Chroma, pgvector)
- Retrieval strategies (semantic, hybrid, reranking)
- Generation with context injection

### LLM Integration
- API integration (OpenAI, Anthropic, Google, local)
- Streaming responses
- Token management and context windows
- Retry strategies and error handling
- Cost optimization

### Agentic Architecture (per arXiv:2510.09244)
- Perception systems for environmental understanding
- Reasoning systems (CoT, ToT, ReAct)
- Memory systems (short-term context, long-term vector stores)
- Execution systems (tool calling, action translation)

## CODE PATTERNS
[DSPy, Agno, RAG implementation patterns]

## STRUCTURED RESPONSE FORMAT
[Standard JSON response format]
</role>

<constraints>
- You are a SPECIALIST. You CANNOT delegate.
- Always consider token limits and costs
- Include proper error handling for LLM calls
- Use streaming for long-running generations
- Document model requirements and dependencies
</constraints>
```

### Security Specialist Prompt Structure

```markdown
<role>
You are the SECURITY SPECIALIST - a technology-agnostic security expert who can analyze and secure code in any programming language or framework.

## CORE MISSION
Perform security analysis and implement secure coding patterns. Identify vulnerabilities, assess risks, and provide remediation guidance.

## EXPERTISE AREAS

### Vulnerability Analysis
- OWASP Top 10 (injection, XSS, CSRF, etc.)
- Authentication and authorization flaws
- Cryptographic weaknesses
- Insecure deserialization
- Security misconfiguration

### Technology-Specific Security
- TypeScript/Node.js: npm audit, prototype pollution, XSS
- Python: command injection, pickle vulnerabilities, SQL injection
- Rust: unsafe blocks, memory safety, dependency audit
- Swift/iOS: keychain usage, certificate pinning, data protection

### Secure Coding Patterns
- Input validation and sanitization
- Output encoding
- Parameterized queries
- Secure session management
- Secrets management

## ANALYSIS FRAMEWORK
1. Identify attack surface
2. Enumerate potential vulnerabilities
3. Assess severity (CVSS-style)
4. Provide remediation steps
5. Suggest preventive measures

## STRUCTURED RESPONSE FORMAT
{
  "status": "success|partial|failed",
  "summary": "Security analysis summary",
  "vulnerabilities": [
    {
      "id": "VULN-001",
      "severity": "high|medium|low",
      "category": "OWASP category",
      "description": "What the vulnerability is",
      "location": "file:line",
      "remediation": "How to fix it"
    }
  ],
  "recommendations": ["General security improvements"],
  "files": { "created": [], "modified": [] }
}
</role>

<constraints>
- You are a SPECIALIST. You CANNOT delegate.
- Adapt analysis to the detected technology stack
- Always provide severity ratings
- Include specific remediation steps, not just descriptions
- Consider both code-level and architectural security
</constraints>
```

---

## Appendix B: Delegation Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ User Request: "Implement a secure RAG pipeline with tests in Python"        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ OmO (Team Lead)                                                             │
│ 1. Classify intent: IMPLEMENTATION (AI/ML + Python + Testing + Security)    │
│ 2. Delegate: task(subagent_type="implementation-specialist")                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Implementation Specialist (Manager)                                         │
│ 1. Decompose task:                                                          │
│    - RAG implementation → ai-ml-expert                                      │
│    - Security review → security-specialist                                  │
│    - Test creation → test-specialist                                        │
│ 2. Delegate in sequence (RAG first, then security, then tests)              │
└─────────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ ai-ml-expert    │  │ security-       │  │ test-specialist │
│                 │  │ specialist      │  │                 │
│ 1. Design RAG   │  │ 1. Review RAG   │  │ 1. Create unit  │
│    pipeline     │  │    for security │  │    tests        │
│ 2. Implement    │  │ 2. Check API    │  │ 2. Create       │
│    with DSPy    │  │    key handling │  │    integration  │
│ 3. Add vector   │  │ 3. Validate     │  │    tests        │
│    store        │  │    input        │  │ 3. Add pytest   │
│                 │  │    sanitization │  │    fixtures     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Implementation Specialist aggregates results:                               │
│ {                                                                           │
│   "status": "success",                                                      │
│   "summary": "Secure RAG pipeline implemented with comprehensive tests",    │
│   "delegations": [                                                          │
│     { "agent": "ai-ml-expert", "status": "success" },                       │
│     { "agent": "security-specialist", "status": "success" },                │
│     { "agent": "test-specialist", "status": "success" }                     │
│   ],                                                                        │
│   "files": {                                                                │
│     "created": ["src/rag/pipeline.py", "src/rag/retriever.py",              │
│                 "tests/test_rag.py", "tests/test_security.py"]              │
│   }                                                                         │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Approval

| Role | Name | Date | Status |
|------|------|------|--------|
| Product Strategist | Claude | 2025-12-18 | ✅ Complete |
| Strategic Architect | - | - | Pending |
| Implementation Lead | - | - | Pending |

---

*Specification created by Product Strategist. Ready for architecture review.*

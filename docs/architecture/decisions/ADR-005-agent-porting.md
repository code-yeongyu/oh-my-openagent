# ADR-005: Porting Workflow Specialist Agents to TypeScript

## Status
Accepted

## Context
Initially, specialized workflow agents (Product Strategist, Strategic Planner, Task Planner) were defined as markdown files in `.opencode/agent/`. These agents were invoked by reading their markdown content and adopting their persona. While flexible, this approach had several limitations:
- **Lack of Type Safety**: Agent definitions and their tool requirements were not validated at compile time.
- **Indirect Execution**: Invoking agents required manual steps to read files and adopt personas, leading to verbose command logic.
- **Limited Integration**: Markdown-based agents had limited access to the plugin's internal state and shared utilities.
- **Maintenance Overhead**: Duplication between markdown instructions and plugin logic.

## Decision
Port the core workflow specialist agents from markdown files to built-in TypeScript agents within the OhMyOpenCode plugin (`src/agents/*.ts`).

### Key Changes:
1.  **TypeScript Agent Definitions**: Create `product-strategist.ts`, `strategic-planner.ts`, and `task-planner.ts` using the `AgentDefinition` type.
2.  **Tool-Based Delegation**: Update workflow commands (`/specify`, `/plan`, `/tasks`) to use the `call_omo_agent` tool for synchronous delegation to these specialists.
3.  **Governance Decoupling**: Move governance logic (path validation, historian, Linear integration) from agent instructions to automatic lifecycle hooks (`src/hooks/governance-*`).
4.  **Role-Based Access Control**: Implement strict tool permissions and delegation policies in code for each agent.

## Consequences

### Positive
- **Performance**: Agents are instantiated directly in memory without file I/O for instructions.
- **Reliability**: Type-safe definitions ensure agents always have the correct model, temperature, and tool configurations.
- **Consistency**: Governance is applied automatically via hooks, ensuring a uniform audit trail and path discipline regardless of which agent is active.
- **Developer Experience**: Commands are simpler and more declarative. The `workflow-state-enforcer` hook provides intelligent delegation hints.
- **Testability**: Agent logic and tool permissions can now be unit tested as TypeScript code.

### Negative
- **Reduced "In-Place" Editability**: Modifying an agent's core definition now requires a plugin rebuild instead of a simple markdown edit.
- **Complexity**: The plugin architecture is more complex as it now manages the full lifecycle and state of sub-sessions.

### Neutral
- **Markdown Backup**: Markdown versions of agents may be kept as "personas" or documentation, but the source of truth for execution is the TypeScript code.

## References
- Porting Issue: [LIF-72](https://linear.app/lifelogger/issue/LIF-72/port-workflow-specialists-to-omo-plugin-and-update-commands)
- Agent Implementation: `src/agents/`
- Command Implementation: `.opencode/command/`
- Governance Hooks: `src/hooks/`

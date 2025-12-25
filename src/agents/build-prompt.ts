/**
 * OpenCode's default build agent system prompt.
 *
 * This prompt enables FULL EXECUTION mode for the build agent, allowing file
 * modifications, command execution, and system changes while focusing on
 * implementation and execution.
 *
 * Inspired by OpenCode's build agent behavior.
 * 
 * @see https://github.com/sst/opencode/blob/6f9bea4e1f3d139feefd0f88de260b04f78caaef/packages/opencode/src/session/prompt/build-switch.txt
 * @see https://github.com/sst/opencode/blob/6f9bea4e1f3d139feefd0f88de260b04f78caaef/packages/opencode/src/agent/agent.ts#L118-L125
 */
export const BUILD_SYSTEM_PROMPT = `<system-reminder>
# Build Mode - System Reminder

BUILD MODE ACTIVE - you are in EXECUTION phase. Your responsibility is to:
- Implement features and make code changes
- Execute commands and run tests
- Fix bugs and refactor code
- Deploy and build systems
- Make all necessary file modifications

You have FULL permissions to edit files, run commands, and make system changes.
This is the implementation phase - execute decisively and thoroughly.

---

## Responsibility

Your current responsibility is to implement, build, and execute. You should:
- Write and modify code to accomplish the user's goals
- Run tests and builds to verify your changes
- Fix errors and issues that arise
- Use all available tools to complete the task efficiently
- Delegate to specialized agents when appropriate for better results

**NOTE:** You should ask the user for clarification when requirements are ambiguous,
but once the path is clear, execute confidently. The goal is to deliver working,
tested, production-ready solutions.

---

## Important

The user wants you to execute and implement. You SHOULD make edits, run necessary
tools, and make changes to accomplish the task. Use your full capabilities to
deliver excellent results.
</system-reminder>
`

/**
 * OpenCode's default build agent permission configuration.
 *
 * Allows the build agent full execution permissions:
 * - edit: "ask" - Can modify files with confirmation
 * - bash: "ask" - Can execute commands with confirmation  
 * - webfetch: "allow" - Can fetch web content
 *
 * This provides balanced permissions - powerful but with safety checks.
 * 
 * @see https://github.com/sst/opencode/blob/6f9bea4e1f3d139feefd0f88de260b04f78caaef/packages/opencode/src/agent/agent.ts#L57-L68
 * @see https://github.com/sst/opencode/blob/6f9bea4e1f3d139feefd0f88de260b04f78caaef/packages/opencode/src/agent/agent.ts#L118-L125
 */
export const BUILD_PERMISSION = {
  edit: "ask" as const,
  bash: "ask" as const,
  webfetch: "allow" as const,
}

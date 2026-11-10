import type { RpcPersona } from "../types"

// The yield tool a workpool worker gets is named `workpool`; the in-process builder adds it to an
// agent's allowlist (child-options.ts), so a process worker's allowlist must keep it too.
const WORKPOOL_YIELD_TOOL_NAME = "workpool"

// senpi reads `--append-system-prompt` as text unless it names a file; one argv entry stays well under
// the kernel's per-argument limit (MAX_ARG_STRLEN, 128 KiB) at this size.
const MAX_INSTRUCTIONS_CHARACTERS = 100_000

export class PersonaTooLargeError extends Error {
  constructor(length: number) {
    super(`agent instructions are ${length} characters; a process child accepts at most ${MAX_INSTRUCTIONS_CHARACTERS}`)
    this.name = "PersonaTooLargeError"
  }
}

/**
 * The persona an in-process child gets from `buildChildSessionOptions` (instructions as the appended
 * system prompt, the allowlist as `tools`, the denylist as `excludeTools`), as senpi CLI flags for a
 * separate-process child. An undefined allowlist means no tool policy; an EMPTY one means no tools.
 */
export function personaArgs(persona: RpcPersona): readonly string[] {
  const args: string[] = []
  if (persona.instructions !== undefined && persona.instructions.length > 0) {
    if (persona.instructions.length > MAX_INSTRUCTIONS_CHARACTERS) throw new PersonaTooLargeError(persona.instructions.length)
    args.push("--append-system-prompt", persona.instructions)
  }
  const allow = persona.toolAllowlist
  if (allow !== undefined) {
    const yieldTool = persona.memberScopedToolNames?.includes(WORKPOOL_YIELD_TOOL_NAME) === true ? [WORKPOOL_YIELD_TOOL_NAME] : []
    const tools = [...new Set([...allow, ...yieldTool])]
    if (tools.length === 0) args.push("--no-tools")
    else args.push("--tools", tools.join(","))
  }
  if (persona.toolDenylist !== undefined && persona.toolDenylist.length > 0) {
    args.push("--exclude-tools", persona.toolDenylist.join(","))
  }
  return args
}

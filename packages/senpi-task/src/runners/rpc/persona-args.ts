import type { RpcPersona } from "../types"

// The yield tool a workpool worker gets is named `workpool`; the in-process builder adds it to an
// agent's allowlist (child-options.ts), so a process worker's allowlist must keep it too.
const WORKPOOL_YIELD_TOOL_NAME = "workpool"

// senpi reads `--append-system-prompt` as text unless it names a file. POSIX caps ONE argv entry at
// MAX_ARG_STRLEN (128 KiB, in bytes), so the budget is UTF-8 bytes with headroom. win32 caps the WHOLE
// command line at 32,767 UTF-16 units, so the budget there leaves room for the rest of the argv.
const MAX_INSTRUCTIONS_BYTES = 100_000
const MAX_INSTRUCTIONS_WIN32_UNITS = 24_000

export class PersonaTooLargeError extends Error {
  constructor(size: number, limit: number, unit: string) {
    super(`agent instructions are ${size} ${unit}; a process child accepts at most ${limit}`)
    this.name = "PersonaTooLargeError"
  }
}

/**
 * The persona an in-process child gets from `buildChildSessionOptions` (instructions as the appended
 * system prompt, the allowlist as `tools`, the denylist as `excludeTools`), as senpi CLI flags for a
 * separate-process child. An undefined allowlist means no tool policy; an EMPTY one means no tools.
 */
export function personaArgs(persona: RpcPersona, platform: NodeJS.Platform = process.platform): readonly string[] {
  const args: string[] = []
  if (persona.instructions !== undefined && persona.instructions.length > 0) {
    assertInstructionsFit(persona.instructions, platform)
    args.push("--append-system-prompt", persona.instructions)
  }
  const allow = persona.toolAllowlist
  if (allow !== undefined) {
    const yieldTool =
      persona.memberScopedToolNames?.includes(WORKPOOL_YIELD_TOOL_NAME) === true ? [WORKPOOL_YIELD_TOOL_NAME] : []
    const tools = [...new Set([...allow, ...yieldTool])]
    if (tools.length === 0) args.push("--no-tools")
    else args.push("--tools", tools.join(","))
  }
  if (persona.toolDenylist !== undefined && persona.toolDenylist.length > 0) {
    args.push("--exclude-tools", persona.toolDenylist.join(","))
  }
  return args
}

function assertInstructionsFit(instructions: string, platform: NodeJS.Platform): void {
  if (platform === "win32") {
    if (instructions.length > MAX_INSTRUCTIONS_WIN32_UNITS)
      throw new PersonaTooLargeError(instructions.length, MAX_INSTRUCTIONS_WIN32_UNITS, "UTF-16 units")
    return
  }
  const bytes = Buffer.byteLength(instructions, "utf8")
  if (bytes > MAX_INSTRUCTIONS_BYTES) throw new PersonaTooLargeError(bytes, MAX_INSTRUCTIONS_BYTES, "UTF-8 bytes")
}

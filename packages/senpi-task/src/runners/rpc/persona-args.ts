import type { RpcPersona } from "../types"

// The yield tool a workpool worker gets is named `workpool`; the in-process builder adds it to an
// agent's allowlist (child-options.ts), so an out-of-process worker's allowlist must keep it too.
const WORKPOOL_YIELD_TOOL_NAME = "workpool"

// senpi reads `--append-system-prompt` as text unless it names a file. POSIX caps ONE argv entry at
// MAX_ARG_STRLEN (128 KiB, in bytes), so the budget is UTF-8 bytes with headroom. win32 caps the WHOLE
// command line at 32,767 UTF-16 units, so the budget there leaves room for the rest of the argv. The
// daemon's `open_session.persona.appendSystemPrompt` holds the same byte budget as one POSIX argv entry.
const MAX_INSTRUCTIONS_BYTES = 100_000
const MAX_INSTRUCTIONS_WIN32_UNITS = 24_000

/** Where a child's persona travels: its own process's argv on a platform, or the daemon's open request. */
export type PersonaCarrier = NodeJS.Platform | "host"

export class PersonaTooLargeError extends Error {
  constructor(size: number, limit: number, unit: string) {
    super(`agent instructions are ${size} ${unit}; an out-of-process child accepts at most ${limit}`)
    this.name = "PersonaTooLargeError"
  }
}

/**
 * The persona an in-process child gets from `buildChildSessionOptions`, in senpi's own terms: the
 * instructions as the appended system prompt, the allowlist as `tools` and the denylist as
 * `excludeTools`. An undefined allowlist means no tool policy; an EMPTY one means no tools at all.
 * Instructions the carrier cannot hold refuse the launch: they are never truncated.
 */
export interface PersonaPolicy {
  readonly appendSystemPrompt?: string
  readonly tools?: readonly string[]
  readonly excludeTools?: readonly string[]
}

export function personaPolicy(persona: RpcPersona, carrier: PersonaCarrier): PersonaPolicy {
  const instructions = persona.instructions
  if (instructions !== undefined && instructions.length > 0) assertInstructionsFit(instructions, carrier)
  const allow = persona.toolAllowlist
  const yieldTool = persona.memberScopedToolNames?.includes(WORKPOOL_YIELD_TOOL_NAME) === true ? [WORKPOOL_YIELD_TOOL_NAME] : []
  const deny = persona.toolDenylist
  return {
    ...(instructions === undefined || instructions.length === 0 ? {} : { appendSystemPrompt: instructions }),
    ...(allow === undefined ? {} : { tools: [...new Set([...allow, ...yieldTool])] }),
    ...(deny === undefined || deny.length === 0 ? {} : { excludeTools: deny }),
  }
}

/** The persona as senpi CLI flags for a child that runs as its own process. */
export function personaArgs(persona: RpcPersona, platform: NodeJS.Platform = process.platform): readonly string[] {
  const policy = personaPolicy(persona, platform)
  const args: string[] = []
  if (policy.appendSystemPrompt !== undefined) args.push("--append-system-prompt", policy.appendSystemPrompt)
  if (policy.tools !== undefined) {
    if (policy.tools.length === 0) args.push("--no-tools")
    else args.push("--tools", policy.tools.join(","))
  }
  if (policy.excludeTools !== undefined) args.push("--exclude-tools", policy.excludeTools.join(","))
  return args
}

function assertInstructionsFit(instructions: string, carrier: PersonaCarrier): void {
  if (carrier === "win32") {
    if (instructions.length > MAX_INSTRUCTIONS_WIN32_UNITS) {
      throw new PersonaTooLargeError(instructions.length, MAX_INSTRUCTIONS_WIN32_UNITS, "UTF-16 units")
    }
    return
  }
  const bytes = Buffer.byteLength(instructions, "utf8")
  if (bytes > MAX_INSTRUCTIONS_BYTES) throw new PersonaTooLargeError(bytes, MAX_INSTRUCTIONS_BYTES, "UTF-8 bytes")
}

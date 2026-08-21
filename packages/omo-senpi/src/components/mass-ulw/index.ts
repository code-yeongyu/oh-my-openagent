import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"

export const MASS_ULW_CUSTOM_TYPE = "omo-mass-ulw:skill-pointer"
export const MASS_ULW_DISABLED_FLAG = "omo-senpi-mass-ulw-disabled"

// `ulw(?!-)` skips the ulw- skill-name family (ulw-plan, ulw-loop, ulw-research) exactly like the
// ultrawork detector: "mass ulw-loop" is a ulw-loop mention, not a mass-ulw request. Reversed
// (`ulw mass`, `ulwmass`) and short (`mulw`, `meth`) aliases fire the same pointer.
const MASS_ULW_PATTERN = /\b(?:mass[\s-]*ulw(?!-)|ulw[\s-]*mass|mulw|meth)\b/i
const SKILL_COMMAND_PREFIX = "/skill:"
const MASS_ULW_SKILL_NAME = "mass-ulw"
const EXPANDED_SKILL_BLOCK_PATTERN = /<skill\s+name="mass-ulw"/i

interface SenpiInputEvent {
  type: "input"
  text: string
  source: "interactive" | "rpc" | "extension"
  streamingBehavior?: "steer" | "followUp"
}

type SenpiInputEventResult = { action: "continue" } | { action: "transform"; text: string }

export function isMassUlwInput(text: string): boolean {
  return MASS_ULW_PATTERN.test(text)
}

export function createMassUlwComponent(): OmoSenpiComponent {
  return {
    name: "mass-ulw",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown): SenpiInputEventResult => handleInput(pi, payload, ctx))
    },
  }
}

function handleInput(pi: SenpiExtensionAPI, payload: unknown, ctx: ComponentContext): SenpiInputEventResult {
  if (ctx.config.getFlag(MASS_ULW_DISABLED_FLAG) === true) {
    return { action: "continue" }
  }

  if (!isSenpiInputEvent(payload)) {
    return { action: "continue" }
  }

  if (payload.source === "extension") {
    return { action: "continue" }
  }

  if (!isMassUlwInput(payload.text)) {
    return { action: "continue" }
  }

  if (isSkillAlreadyInvoked(payload.text)) {
    return { action: "continue" }
  }

  const content = massUlwSkillPointer()

  // A queued prompt carries the pointer inside its own message so the pair stays atomic through
  // senpi's one-at-a-time queue drain; appending keeps a leading `/skill:` command expandable.
  if (payload.streamingBehavior !== undefined) {
    return { action: "transform", text: `${payload.text}\n${content}` }
  }

  pi.sendMessage({
    customType: MASS_ULW_CUSTOM_TYPE,
    content,
    display: false,
  })

  return { action: "continue" }
}

function massUlwSkillPointer(): string {
  const skillsRoot = getBuiltinSkillsRoot()
  return `<omo-mass-ulw-pointer>The user asked for mass-ulw. Read the mass-ulw skill at ${skillsRoot}mass-ulw/SKILL.md with the read tool and follow it: orchestrate the requested work as a dependency graph of child agents with the dag tool.</omo-mass-ulw-pointer>`
}

function isSkillAlreadyInvoked(text: string): boolean {
  if (EXPANDED_SKILL_BLOCK_PATTERN.test(text)) {
    return true
  }

  if (!text.startsWith(SKILL_COMMAND_PREFIX)) {
    return false
  }

  const spaceIndex = text.indexOf(" ")
  const skillName =
    spaceIndex === -1 ? text.slice(SKILL_COMMAND_PREFIX.length) : text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
  return skillName === MASS_ULW_SKILL_NAME
}

function isSenpiInputEvent(value: unknown): value is SenpiInputEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (candidate["type"] !== "input") {
    return false
  }

  if (typeof candidate["text"] !== "string" || candidate["text"].length === 0) {
    return false
  }

  return candidate["source"] === "interactive" || candidate["source"] === "rpc" || candidate["source"] === "extension"
}

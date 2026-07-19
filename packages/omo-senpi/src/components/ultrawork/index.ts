import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

// `ulw(?!-)` keeps generous matching ("하이ulw", "ulw_helper.ts") while skipping the
// `ulw-` skill-name family (ulw-plan, ulw-loop, ulw-research): typing a skill name
// must not arm ultrawork mode on top of the skill itself.
const ULTRAWORK_CURRENT_PROMPT_PATTERN = /(?:ultrawork|ulw(?!-))/i
const ULTRAWORK_DISABLED_FLAG = "omo-senpi-ultrawork-disabled"
const ULTRAWORK_MODE_OPEN_TAG = "<ultrawork-mode>"
const ULTRAWORK_MODE_CLOSE_TAG = "</ultrawork-mode>"
const SKILL_COMMAND_PREFIX = "/skill:"
const ULTRAWORK_SKILL_NAME = "ultrawork"

interface SenpiInputEvent {
  type: "input"
  text: string
  images?: unknown[]
  source: "interactive" | "rpc" | "extension"
}

type SenpiInputEventResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: unknown[] }
  | { action: "handled" }

export function createUltraworkComponent(): OmoSenpiComponent {
  return {
    name: "ultrawork",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown): SenpiInputEventResult => handleInput(payload, ctx))
    },
  }
}

export function isUltraworkInput(text: string): boolean {
  return ULTRAWORK_CURRENT_PROMPT_PATTERN.test(text)
}

function handleInput(payload: unknown, ctx: ComponentContext): SenpiInputEventResult {
  if (ctx.config.getFlag(ULTRAWORK_DISABLED_FLAG) === true) {
    return { action: "continue" }
  }

  if (!isSenpiInputEvent(payload)) {
    return { action: "continue" }
  }

  if (payload.source === "extension") {
    return { action: "continue" }
  }

  if (!isUltraworkInput(payload.text)) {
    return { action: "continue" }
  }

  // A pasted transcript (or an earlier injection) already carries the directive
  // block; injecting again would duplicate the same ~17KB of rules in one message.
  // Require the matched tag PAIR: merely mentioning "<ultrawork-mode>" in a
  // question must not silently disarm a legitimate trigger.
  if (payload.text.includes(ULTRAWORK_MODE_OPEN_TAG) && payload.text.includes(ULTRAWORK_MODE_CLOSE_TAG)) {
    return { action: "continue" }
  }

  // Senpi expands `/skill:name args` only while the prompt still STARTS with the
  // command (agent-session `_expandSkillCommand`). Appending preserves that
  // contract; prepending would silently disable native skill expansion.
  if (payload.text.startsWith(SKILL_COMMAND_PREFIX)) {
    // Mirror senpi's parse exactly: skill name runs to the FIRST space (or end).
    const spaceIndex = payload.text.indexOf(" ")
    const skillName = spaceIndex === -1 ? payload.text.slice(SKILL_COMMAND_PREFIX.length) : payload.text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
    const args = spaceIndex === -1 ? "" : payload.text.slice(spaceIndex + 1)

    // `/skill:ultrawork` expansion already inlines the full SKILL.md, whose body
    // IS the directive block. Appending here would either duplicate the block
    // (with args) or corrupt the skill name senpi parses (without args, the
    // appended newline+directive becomes part of the name and expansion fails).
    if (skillName === ULTRAWORK_SKILL_NAME) {
      return { action: "continue" }
    }

    // Arm only when the user's own words (the args) carry a trigger; a trigger
    // that appears solely inside the skill NAME must not arm the mode.
    if (!isUltraworkInput(args)) {
      return { action: "continue" }
    }

    return {
      action: "transform",
      text: `${payload.text}\n${SENPI_ULTRAWORK_DIRECTIVE}`,
      images: payload.images,
    }
  }

  return {
    action: "transform",
    text: `${SENPI_ULTRAWORK_DIRECTIVE}\n${payload.text}`,
    images: payload.images,
  }
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

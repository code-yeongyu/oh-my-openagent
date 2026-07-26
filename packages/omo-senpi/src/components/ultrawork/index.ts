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
const ULTRAWORK_CUSTOM_TYPE = "omo-ultrawork:directive"

interface SenpiInputEvent {
  type: "input"
  text: string
  source: "interactive" | "rpc" | "extension"
  streamingBehavior?: "steer" | "followUp"
}

type SenpiInputEventResult = { action: "continue" } | { action: "transform"; text: string }

export function createUltraworkComponent(): OmoSenpiComponent {
  return {
    name: "ultrawork",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown): SenpiInputEventResult => handleInput(pi, payload, ctx))
    },
  }
}

export function isUltraworkInput(text: string): boolean {
  return ULTRAWORK_CURRENT_PROMPT_PATTERN.test(text)
}

function handleInput(pi: SenpiExtensionAPI, payload: unknown, ctx: ComponentContext): SenpiInputEventResult {
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
  // block; injecting again would duplicate the same ~17KB of rules in one turn.
  // Require the matched tag PAIR: merely mentioning "<ultrawork-mode>" in a
  // question must not silently disarm a legitimate trigger.
  if (payload.text.includes(ULTRAWORK_MODE_OPEN_TAG) && payload.text.includes(ULTRAWORK_MODE_CLOSE_TAG)) {
    return { action: "continue" }
  }

  // Any defined streamingBehavior means senpi will QUEUE this prompt instead of
  // sending it now, which changes how the directive has to travel.
  const isQueued = payload.streamingBehavior !== undefined

  if (payload.text.startsWith(SKILL_COMMAND_PREFIX)) {
    // Mirror senpi's parse exactly: skill name runs to the FIRST space (or end).
    const spaceIndex = payload.text.indexOf(" ")
    const skillName = spaceIndex === -1 ? payload.text.slice(SKILL_COMMAND_PREFIX.length) : payload.text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
    const args = spaceIndex === -1 ? "" : payload.text.slice(spaceIndex + 1)

    // `/skill:ultrawork` expansion already inlines the full SKILL.md, whose body
    // IS the directive block, so arming again would duplicate it in one turn.
    if (skillName === ULTRAWORK_SKILL_NAME) {
      return { action: "continue" }
    }

    // Arm only when the user's own words (the args) carry a trigger; a trigger
    // that appears solely inside the skill NAME must not arm the mode.
    if (!isUltraworkInput(args)) {
      return { action: "continue" }
    }
  }

  return armUltrawork(pi, payload.text, isQueued)
}

/**
 * Arm ultrawork mode.
 *
 * Idle prompts get the directive as a hidden custom message: senpi converts custom
 * messages into `role: "user"` context (core/messages.ts `convertToLlm`) so the model
 * still receives every rule, while `display: false` keeps the TUI from rendering ~17KB
 * of directive above what the user actually typed (interactive-mode renders
 * `case "custom"` only when `message.display`). `sendCustomMessage` appends
 * synchronously on that path, so the directive lands ahead of the user message this
 * very `input` event is still gating. The typed text stays byte-identical, so senpi's
 * native `/skill:` expansion cannot be disturbed by this hook.
 *
 * A QUEUED prompt cannot use that route. Senpi drains its steering and follow-up
 * queues one message at a time by default (`PendingMessageQueue` in agent.ts, and
 * `getFollowUpMode()` defaulting to "one-at-a-time") and runs an assistant turn per
 * drained message, so a separate hidden message would be answered on its own turn
 * before the user's actual ask arrived. Keep the pair atomic by carrying the directive
 * inside that one queued message instead. Appending rather than prepending is what
 * preserves `/skill:` expansion, which only fires while the text still STARTS with the
 * command.
 */
function armUltrawork(pi: SenpiExtensionAPI, text: string, isQueued: boolean): SenpiInputEventResult {
  if (isQueued) {
    return { action: "transform", text: `${text}\n${SENPI_ULTRAWORK_DIRECTIVE}` }
  }

  pi.sendMessage({
    customType: ULTRAWORK_CUSTOM_TYPE,
    content: SENPI_ULTRAWORK_DIRECTIVE,
    display: false,
  })

  return { action: "continue" }
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

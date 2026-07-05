import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

const ULTRAWORK_CURRENT_PROMPT_PATTERN = /(?:ultrawork|ulw)/i
const ULTRAWORK_DISABLED_FLAG = "omo-senpi-ultrawork-disabled"

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

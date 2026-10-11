import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveBundledSkillsDir } from "../bundled-skills"
import { type AutocompleteProviderLike, wrapWithBareSkillCommands } from "./autocomplete"
import { type HostCommandInfo, readBundledSkillNames, resolveBareSkillCommand } from "./bare-skill-command"

export const SKILL_COMMANDS_COMPONENT_NAME = "skill-commands"

export interface SkillCommandsComponentOptions {
  /** Overrides the packaged skills root; tests point it at a fixture. */
  readonly skillsDir?: string
}

type InputResult = { action: "continue" } | { action: "handled" } | { action: "transform"; text: string; images?: unknown[] }

interface InputEvent {
  readonly text: string
  readonly source: unknown
  readonly images?: unknown[]
}

interface EventUi {
  notify?(message: string, type?: "info" | "warning" | "error"): void
  addAutocompleteProvider?(factory: (current: AutocompleteProviderLike) => AutocompleteProviderLike): void
}

/**
 * Makes the bare `/<bundled-skill> args` form that omo's docs, skills, and plan handoffs tell users
 * to type behave exactly like `/skill:<name> args` (#9042).
 *
 * The rewrite happens in the input event, ahead of every other omo input handler, instead of in a
 * registered command: a command handler could only re-submit through `sendUserMessage`, whose
 * `extension` source would drop the human provenance the ulw-plan gate, ultrawork, skill pointers,
 * and continuation resets key on. Rewritten here, the submission keeps its `interactive`/`rpc`
 * source and every downstream handler sees the canonical `/skill:` form before senpi expands it.
 */
export function createSkillCommandsComponent(options: SkillCommandsComponentOptions = {}): OmoSenpiComponent {
  return {
    name: SKILL_COMMANDS_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const bundledSkillNames = readBundledSkillNames(options.skillsDir ?? resolveBundledSkillsDir())
      if (bundledSkillNames.size === 0) {
        ctx.logger.debug?.("no bundled skills found; bare skill commands disabled", { component: SKILL_COMMANDS_COMPONENT_NAME })
        return
      }
      const hostCommands = (): readonly HostCommandInfo[] | undefined => pi.getCommands?.()

      pi.on("input", (payload: unknown, eventCtx: unknown): InputResult => {
        const event = readInputEvent(payload)
        if (event === undefined || event.source === "extension") return { action: "continue" }
        const resolution = resolveBareSkillCommand(event.text, bundledSkillNames, hostCommands())
        switch (resolution.kind) {
          case "not-bare-skill":
          case "shadowed":
            return { action: "continue" }
          case "unavailable":
            readUi(eventCtx)?.notify?.(
              `/${resolution.name} is unavailable: the ${resolution.name} skill is disabled (disabled_skills) or not loaded.`,
              "warning",
            )
            return { action: "handled" }
          case "expand":
            return event.images === undefined
              ? { action: "transform", text: resolution.text }
              : { action: "transform", text: resolution.text, images: event.images }
        }
      })

      pi.on("session_start", (_payload: unknown, eventCtx: unknown) => {
        readUi(eventCtx)?.addAutocompleteProvider?.((current) =>
          wrapWithBareSkillCommands(current, bundledSkillNames, hostCommands),
        )
      })
    },
  }
}

function readInputEvent(payload: unknown): InputEvent | undefined {
  if (!isRecord(payload) || payload["type"] !== "input") return undefined
  const text = payload["text"]
  if (typeof text !== "string") return undefined
  const images = payload["images"]
  return Array.isArray(images) ? { text, source: payload["source"], images } : { text, source: payload["source"] }
}

function readUi(eventCtx: unknown): EventUi | undefined {
  if (!isRecord(eventCtx)) return undefined
  const ui = eventCtx["ui"]
  return isRecord(ui) ? ui : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

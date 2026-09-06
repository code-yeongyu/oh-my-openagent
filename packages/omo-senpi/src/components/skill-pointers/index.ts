import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"

export const MASS_ULW_CUSTOM_TYPE = "omo-mass-ulw:skill-pointer"
export const ULW_PLAN_CUSTOM_TYPE = "omo-ulw-plan:skill-pointer"
export const ULW_LOOP_CUSTOM_TYPE = "omo-ulw-loop:skill-pointer"
export const ULW_RESEARCH_CUSTOM_TYPE = "omo-ulw-research:skill-pointer"
export const SKILL_POINTERS_DISABLED_FLAG = "omo-senpi-skill-pointers-disabled"

const SKILL_COMMAND_PREFIX = "/skill:"

interface SkillPointerTarget {
  readonly skillName: string
  readonly customType: string
  readonly pattern: RegExp
  readonly expandedBlockPattern: RegExp
  readonly instruction: string
  readonly extra?: string
}

// One uniform keyword table, no cross-keyword exceptions: every pattern matches
// independently and overlapping mentions all fire ("mass ulw-loop" injects the mass-ulw
// AND ulw-loop pointers while the ultrawork component arms on the same text). `\b` on
// both edges is the only boundary rule; `[\s-]*` accepts spaced, hyphenated, and fused
// spellings alike.
//
// The mass aliases that carry no literal "ulw" (`mulw`, `meth`) and the reversed spelling
// (`ulw mass`) leave no `ulw <skill>` for the per-skill patterns to match, so each of them
// also stands in for the `ulw` half: "mulw research" names the same composite as
// "mass ulw research" and loads both skills.
const MASS_ALIAS = String.raw`(?:mass[\s-]*ulw|ulw[\s-]*mass|mulw|meth)`
const TARGETS: readonly SkillPointerTarget[] = [
  {
    skillName: "mass-ulw",
    customType: MASS_ULW_CUSTOM_TYPE,
    pattern: new RegExp(String.raw`\b${MASS_ALIAS}\b`, "i"),
    expandedBlockPattern: /<skill\s+name="mass-ulw"/i,
    instruction: "dispatch each phase's dependency-ordered lanes as one run of the workflow tool composed in an eval cell, start a new run per phase rather than one graph for the whole job, and when a ulw-loop or ulw-execute contract is active let it own the goal",
  },
  {
    skillName: "ulw-plan",
    customType: ULW_PLAN_CUSTOM_TYPE,
    pattern: /\bulw[\s-]*plan\b/i,
    expandedBlockPattern: /<skill\s+name="ulw-plan"/i,
    instruction: "run the explore-first planning workflow and produce one decision-complete work plan",
  },
  {
    skillName: "ulw-loop",
    customType: ULW_LOOP_CUSTOM_TYPE,
    pattern: /\bulw[\s-]*loop\b/i,
    expandedBlockPattern: /<skill\s+name="ulw-loop"/i,
    instruction: "run the goal-driven ultrawork loop with evidence-bound execution",
    extra: ulwLoopCliShimSentence(),
  },
  {
    skillName: "ulw-research",
    customType: ULW_RESEARCH_CUSTOM_TYPE,
    pattern: new RegExp(String.raw`\b(?:ulw|${MASS_ALIAS})[\s-]*research\b`, "i"),
    expandedBlockPattern: /<skill\s+name="ulw-research"/i,
    instruction: "orchestrate team-first maximum-saturation research",
  },
]

interface SenpiInputEvent {
  type: "input"
  text: string
  source: "interactive" | "rpc" | "extension"
  streamingBehavior?: "steer" | "followUp"
}

type SenpiInputEventResult = { action: "continue" } | { action: "transform"; text: string }

export function matchedSkillPointerNames(text: string): string[] {
  return TARGETS.filter((target) => target.pattern.test(text)).map((target) => target.skillName)
}

export function createSkillPointersComponent(): OmoSenpiComponent {
  return {
    name: "skill-pointers",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown): SenpiInputEventResult => handleInput(pi, payload, ctx))
    },
  }
}

function handleInput(pi: SenpiExtensionAPI, payload: unknown, ctx: ComponentContext): SenpiInputEventResult {
  if (ctx.config.getFlag(SKILL_POINTERS_DISABLED_FLAG) === true) {
    return { action: "continue" }
  }

  if (!isSenpiInputEvent(payload)) {
    return { action: "continue" }
  }

  if (payload.source === "extension") {
    return { action: "continue" }
  }

  const commandSkillName = skillCommandName(payload.text)
  const targets = TARGETS.filter(
    (target) =>
      target.pattern.test(payload.text) &&
      target.skillName !== commandSkillName &&
      !target.expandedBlockPattern.test(payload.text),
  )

  if (targets.length === 0) {
    return { action: "continue" }
  }

  // A queued prompt carries the pointers inside its own message so the group stays atomic
  // through senpi's one-at-a-time queue drain; appending keeps a leading `/skill:` command
  // expandable.
  if (payload.streamingBehavior !== undefined) {
    const pointers = targets.map((target) => skillPointer(target))
    return { action: "transform", text: [payload.text, ...pointers].join("\n") }
  }

  for (const target of targets) {
    pi.sendMessage({
      customType: target.customType,
      content: skillPointer(target),
      display: false,
    })
  }

  return { action: "continue" }
}

function ulwLoopCliShimPath(): string {
  return fileURLToPath(new URL("../runtime/agent-toolkit/omo-agent-toolkit", import.meta.url))
}

function ulwLoopCliShimSentence(): string {
  const abs = ulwLoopCliShimPath().replaceAll("\\", "/")
  return ` The resolved ulw-loop CLI shim is at ${abs} — invoke every ulw-loop command as \`${abs} ulw-loop <subcommand>\`.`
}

function skillPointer(target: SkillPointerTarget): string {
  const skillsRoot = getBuiltinSkillsRoot()
  const extra = target.extra ?? ""
  return `<omo-${target.skillName}-pointer>The user asked for ${target.skillName}. Read the ${target.skillName} skill at ${skillsRoot}${target.skillName}/SKILL.md with the read tool and follow it: ${target.instruction}.${extra}</omo-${target.skillName}-pointer>`
}

function skillCommandName(text: string): string | undefined {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) {
    return undefined
  }

  const spaceIndex = text.indexOf(" ")
  return spaceIndex === -1 ? text.slice(SKILL_COMMAND_PREFIX.length) : text.slice(SKILL_COMMAND_PREFIX.length, spaceIndex)
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

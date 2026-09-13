
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"
import { resolveUlwLoopSessionScope } from "../ulw-loop/session-scope"
import { stripQuotedRegions } from "./strip-quoted-regions"

export const MASS_ULW_CUSTOM_TYPE = "omo-mass-ulw:skill-pointer"
export const ULW_PLAN_CUSTOM_TYPE = "omo-ulw-plan:skill-pointer"
export const ULW_LOOP_CUSTOM_TYPE = "omo-ulw-loop:skill-pointer"
export const ULW_RESEARCH_CUSTOM_TYPE = "omo-ulw-research:skill-pointer"
export const ULTIMATE_BROWSING_CUSTOM_TYPE = "omo-ultimate-browsing:skill-pointer"
export const SKILL_POINTERS_DISABLED_FLAG = "omo-senpi-skill-pointers-disabled"

const SKILL_COMMAND_PREFIX = "/skill:"

interface SkillPointerTarget {
  readonly skillName: string
  readonly customType: string
  readonly pattern: RegExp
  readonly expandedBlockPattern: RegExp
  readonly instruction: string
  readonly extra?: (sessionScope: string | null) => string
  readonly companions?: readonly SkillCompanion[]
}

// A companion is a skill the parent workflow runs on. It has no keyword of its own: it rides on
// every invocation of its parent, including the paths that dedup the parent's own pointer
// (a raw `/skill:<parent>` command, an expanded `<skill name="<parent>">` block), and is skipped
// only when the input already carries the companion itself.
interface SkillCompanion {
  readonly skillName: string
  readonly customType: string
  readonly expandedBlockPattern: RegExp
  readonly role: string
  readonly instruction: string
}

interface SkillPointerMessage {
  readonly customType: string
  readonly content: string
}

const ULTIMATE_BROWSING_COMPANION: SkillCompanion = {
  skillName: "ultimate-browsing",
  customType: ULTIMATE_BROWSING_CUSTOM_TYPE,
  expandedBlockPattern: /<skill\s+name="ultimate-browsing"/i,
  role: "runs its browsing lanes on the ultimate-browsing skill",
  instruction: 'arm every browsing lane or member with load_skills: ["ultimate-browsing"]',
}

// After quoted regions are removed, patterns match independently and overlapping
// mentions all fire ("mass ulw-loop" injects the mass-ulw
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
    extra: ulwLoopToolSentence,
  },
  {
    skillName: "ulw-research",
    customType: ULW_RESEARCH_CUSTOM_TYPE,
    pattern: new RegExp(String.raw`\b(?:ulw|${MASS_ALIAS})[\s-]*research\b`, "i"),
    expandedBlockPattern: /<skill\s+name="ulw-research"/i,
    instruction: "orchestrate team-first maximum-saturation research",
    companions: [ULTIMATE_BROWSING_COMPANION],
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
  const visible = stripQuotedRegions(text)
  return TARGETS.filter((target) => target.pattern.test(visible)).map((target) => target.skillName)
}

export function createSkillPointersComponent(): OmoSenpiComponent {
  return {
    name: "skill-pointers",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      pi.on("input", (payload: unknown, eventCtx: unknown): SenpiInputEventResult =>
        handleInput(pi, payload, ctx, resolveUlwLoopSessionScope(eventCtx)),
      )
    },
  }
}

function handleInput(
  pi: SenpiExtensionAPI,
  payload: unknown,
  ctx: ComponentContext,
  sessionScope: string | null,
): SenpiInputEventResult {
  if (ctx.config.getFlag(SKILL_POINTERS_DISABLED_FLAG) === true) {
    return { action: "continue" }
  }

  if (!isSenpiInputEvent(payload)) {
    return { action: "continue" }
  }

  if (payload.source === "extension") {
    return { action: "continue" }
  }

  // Structural dedup keys on the injected markup itself, so it reads the RAW text; only the keyword
  // test runs against the text with quoted and relayed regions removed.
  const commandSkillName = skillCommandName(payload.text)
  const visible = stripQuotedRegions(payload.text)
  const alreadyLoaded = (skillName: string, expandedBlockPattern: RegExp): boolean =>
    skillName === commandSkillName || expandedBlockPattern.test(payload.text)
  const invoked = TARGETS.filter((target) => target.pattern.test(visible))
  const pointers: SkillPointerMessage[] = invoked
    .filter((target) => !alreadyLoaded(target.skillName, target.expandedBlockPattern))
    .map((target) => ({ customType: target.customType, content: skillPointer(target, sessionScope) }))
  for (const parent of invoked) {
    for (const companion of parent.companions ?? []) {
      if (alreadyLoaded(companion.skillName, companion.expandedBlockPattern)) continue
      if (pointers.some((pointer) => pointer.customType === companion.customType)) continue
      pointers.push({ customType: companion.customType, content: companionPointer(parent, companion) })
    }
  }

  if (pointers.length === 0) {
    return { action: "continue" }
  }

  // A queued prompt carries the pointers inside its own message so the group stays atomic
  // through senpi's one-at-a-time queue drain; appending keeps a leading `/skill:` command
  // expandable.
  if (payload.streamingBehavior !== undefined) {
    return { action: "transform", text: [payload.text, ...pointers.map((pointer) => pointer.content)].join("\n") }
  }

  for (const pointer of pointers) {
    pi.sendMessage({
      customType: pointer.customType,
      content: pointer.content,
      display: false,
    })
  }

  return { action: "continue" }
}

// Native no longer ships a toolkit CLI: the loop is driven by the registered tool. The session id
// still travels explicitly because an eval kernel does not inherit the session env.
function ulwLoopToolSentence(sessionScope: string | null): string {
  const base = ' Drive every ulw-loop operation with the registered tool, for example `tool.omo_agent_toolkit({ operation: "status" })`; do not spawn a CLI.'
  if (sessionScope === null) return base
  return `${base} This session's state lives under .omo/ulw-loop/${sessionScope}/.`
}

// A keyword proves a mention, not a request to run the workflow.
function skillPointer(target: SkillPointerTarget, sessionScope: string | null): string {
  const skillsRoot = getBuiltinSkillsRoot()
  const extra = target.extra?.(sessionScope) ?? ""
  return `<omo-${target.skillName}-pointer>This message mentions ${target.skillName}. If the user of this session is asking to run ${target.skillName}, read the ${target.skillName} skill at ${skillsRoot}${target.skillName}/SKILL.md with the read tool and follow it: ${target.instruction}. If ${target.skillName} is only being discussed, quoted, or relayed from another session, ignore this pointer.${extra}</omo-${target.skillName}-pointer>`
}

function companionPointer(parent: SkillPointerTarget, companion: SkillCompanion): string {
  const skillsRoot = getBuiltinSkillsRoot()
  return `<omo-${companion.skillName}-pointer>${parent.skillName} ${companion.role}. If the user of this session is asking to run ${parent.skillName}, read the ${companion.skillName} skill at ${skillsRoot}${companion.skillName}/SKILL.md with the read tool in the same turn as the ${parent.skillName} skill and ${companion.instruction}. If ${parent.skillName} is only being discussed, quoted, or relayed from another session, ignore this pointer.</omo-${companion.skillName}-pointer>`
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

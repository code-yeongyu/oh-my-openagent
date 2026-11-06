
import { readSessionRole } from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { getBuiltinSkillsRoot } from "../telemetry/product-identity"
import { resolveUlwLoopSessionScope } from "../ulw-loop/session-scope"
import { NOT_AFTER_IDENTIFIER, NOT_BEFORE_PATH, NOT_INTO_IDENTIFIER, stripQuotedRegions } from "./strip-quoted-regions"

export const MASS_ULW_CUSTOM_TYPE = "omo-mass-ulw:skill-pointer"
export const ULW_PLAN_CUSTOM_TYPE = "omo-ulw-plan:skill-pointer"
export const ULW_LOOP_CUSTOM_TYPE = "omo-ulw-loop:skill-pointer"
export const ULW_RESEARCH_CUSTOM_TYPE = "omo-ulw-research:skill-pointer"
export const BROWSER_CUSTOM_TYPE = "omo-browser:skill-pointer"
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
  // A binding target enters its mode instead of asking the model whether the user meant it: the
  // conditional pointer let the model skip mass-ulw entirely (#10810). Binding is POSITIVE: only a
  // fixed request form matches (`bindingForms`). Every other mention (a statement or a
  // question about the skill, a relayed report, the plain-word alias `meth`) keeps the conditional
  // pointer, because forcing a workflow run onto it is the wrong answer.
  readonly bindingPattern?: RegExp
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

// Research sources are read in the user's browser, so the browser skill rides on every research
// invocation; ultimate-browsing stays a companion for the hosts that browser cannot open.
const BROWSER_COMPANION: SkillCompanion = {
  skillName: "browser",
  customType: BROWSER_CUSTOM_TYPE,
  expandedBlockPattern: /<skill\s+name="browser"/i,
  role: "reads its sources in the user's browser through the browser skill's attached engine",
  instruction:
    'arm every web lane with load_skills: ["browser"] and name that SKILL.md path in every web member brief, since team members carry no load_skills',
}

const ULTIMATE_BROWSING_COMPANION: SkillCompanion = {
  skillName: "ultimate-browsing",
  customType: ULTIMATE_BROWSING_CUSTOM_TYPE,
  expandedBlockPattern: /<skill\s+name="ultimate-browsing"/i,
  role: "sends the hosts the user's browser cannot open to the ultimate-browsing skill",
  instruction: 'arm a lane that must reach a blocked host with load_skills: ["ultimate-browsing"]',
}

// After quoted regions are removed, patterns match independently and overlapping
// mentions all fire ("mass ulw-loop" injects the mass-ulw
// AND ulw-loop pointers while the ultrawork component arms on the same text). Each pattern
// is wrapped by `skillNamePattern`, so a name inside a longer identifier or path does not
// match; `[\s-]*` accepts spaced, hyphenated, and fused spellings alike.
//
// The mass aliases that carry no literal "ulw" (`mulw`, `meth`) and the reversed spelling
// (`ulw mass`) leave no `ulw <skill>` for the per-skill patterns to match, so each of them
// also stands in for the `ulw` half: "mulw research" names the same composite as
// "mass ulw research" and loads both skills.
const MASS_ALIAS = String.raw`(?:mass[\s-]*ulw|ulw[\s-]*mass|mulw|meth)`
// Binding forms, and the only ones: a missed bind costs the user a retyped prompt, while a false bind
// forces a workflow run onto a session that only read the name (a relayed lane report did, #10822).
//   (a) the skill's slash command opens the prompt: "/mass-ulw ...", "/mulw ...", "/ulw-research ...";
//   (b) the prompt's first word is a verb from a fixed list and the keyword follows it directly, then
//       the prompt ends or continues with a connector: "run mass ulw on the flaky suite",
//       "use ulw-research to compare ...". The Korean form puts the keyword first and the verb right
//       after it, ending the sentence: "mass ulw 돌려줘", "ulw research 실행해", "mass ulw로 써줘".
// Everything else, keyword-first sentences, statements and questions included, keeps the conditional
// pointer. Only image/paste placeholders may precede the request: a masked quote or relay never does.
const BIND_LEAD = String.raw`^\s*(?:\[(?:Image|Pasted text)\b[^\]\n]*\]\s*)*`
const BIND_VERB = String.raw`(?:run|start|use|do|execute)`
// A `?` anywhere after the keyword makes the prompt a question, so it never binds ("use mass ulw. Is that the
// right choice?"); a URL's own `?` is masked before this test. A masked span (a pasted URL) may follow directly.
// The full-width question mark (U+FF1F) that Korean and Japanese IMEs type counts too.
const NO_QUESTION = String.raw`(?![\s\S]*[?\uFF1F])`
// A `.` after the keyword must end the sentence: "run mass ulw.ts again" names a file, not the skill.
const BIND_FOLLOW = String.raw`(?=\s*(?:$|[,!:;\n\0]|\.(?:\s|$)|(?:to|on|for|with|and|now|here)\b))${NO_QUESTION}`
// The Korean form takes exactly one request ending, closing the sentence: a question ("돌려도 돼?") or a
// past-tense or declarative ending ("돌렸어", "했는데", "하니") is not a request.
const KOREAN_VERB = String.raw`\s*(?:(?:으로|로|를|을)\s*)?(?:돌려줘|실행해줘|써줘|해줘|돌려|실행해)(?=\s*(?:[.!\n]|$))${NO_QUESTION}`
const bindingForms = (command: string, keyword: string): RegExp =>
  new RegExp(
    [
      // skill-commands (registered first, #9042) rewrites a bare "/mass-ulw" to "/skill:mass-ulw", so both spellings count.
      String.raw`${BIND_LEAD}\/(?:skill:)?${command}(?=\s|$)${NO_QUESTION}`,
      String.raw`${BIND_LEAD}${BIND_VERB}\s+${keyword}${BIND_FOLLOW}`,
      String.raw`${BIND_LEAD}${keyword}${KOREAN_VERB}`,
    ].join("|"),
    "i",
  )
const MASS_KEYWORD = String.raw`(?:mass[\s-]*ulw|ulw[\s-]*mass|mulw)`
// A skill name is a request only as a word of its own: not a segment of a longer identifier
// (`mass-ulw-refactor`, `senpi-ulw-loop`) and not part of a path or file name (`.omo/ulw-plan/`).
const skillNamePattern = (body: string): RegExp => new RegExp(String.raw`${NOT_AFTER_IDENTIFIER}\b${body}\b${NOT_INTO_IDENTIFIER}${NOT_BEFORE_PATH}`, "i")
const TARGETS: readonly SkillPointerTarget[] = [
  {
    skillName: "mass-ulw",
    customType: MASS_ULW_CUSTOM_TYPE,
    pattern: skillNamePattern(MASS_ALIAS),
    expandedBlockPattern: /<skill\s+name="mass-ulw"/i,
    instruction: "dispatch each phase's dependency-ordered lanes as one run of the workflow tool composed in an eval cell, start a new run per phase rather than one graph for the whole job, and when a ulw-loop or ulw-execute contract is active let it own the goal",
    // The trailing composite "... mass ulw research" invokes both skills.
    bindingPattern: bindingForms(String.raw`(?:mass-ulw|mulw)`, String.raw`${MASS_KEYWORD}(?:[\s-]*research)?`),
  },
  {
    skillName: "ulw-plan",
    customType: ULW_PLAN_CUSTOM_TYPE,
    pattern: skillNamePattern(String.raw`ulw[\s-]*plan`),
    expandedBlockPattern: /<skill\s+name="ulw-plan"/i,
    instruction: "run the explore-first planning workflow and produce one decision-complete work plan",
  },
  {
    skillName: "ulw-loop",
    customType: ULW_LOOP_CUSTOM_TYPE,
    pattern: skillNamePattern(String.raw`ulw[\s-]*loop`),
    expandedBlockPattern: /<skill\s+name="ulw-loop"/i,
    instruction: "run the goal-driven ultrawork loop with evidence-bound execution",
    extra: ulwLoopToolSentence,
  },
  {
    skillName: "ulw-research",
    customType: ULW_RESEARCH_CUSTOM_TYPE,
    pattern: skillNamePattern(String.raw`(?:ulw|${MASS_ALIAS})[\s-]*research`),
    expandedBlockPattern: /<skill\s+name="ulw-research"/i,
    instruction: "orchestrate team-first maximum-saturation research",
    companions: [BROWSER_COMPANION, ULTIMATE_BROWSING_COMPANION],
    bindingPattern: bindingForms(String.raw`(?:ulw-research|(?:mass-ulw|mulw)\s+research)`, String.raw`(?:ulw|${MASS_KEYWORD})[\s-]*research`),
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
  return TARGETS.filter((target) => target.pattern.test(visible) || target.bindingPattern?.test(visible) === true).map((target) => target.skillName)
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

  // A delegated session (task child, DAG child, team member) is driven by its brief, the same rule the
  // ultrawork component applies: a skill its brief names is context for the work, never a request (#9740).
  if (readSessionRole(pi) !== undefined) {
    return { action: "continue" }
  }

  // Structural dedup keys on the injected markup itself, so it reads the RAW text; only the keyword
  // test runs against the text with quoted and relayed regions removed.
  const commandSkillName = skillCommandName(payload.text)
  const visible = stripQuotedRegions(payload.text)
  const alreadyLoaded = (skillName: string, expandedBlockPattern: RegExp): boolean =>
    skillName === commandSkillName || expandedBlockPattern.test(payload.text)
  // A binding target its own slash command loaded is bound too (form (a) matches the rewritten /skill: text). The
  // command loads the skill body, but the mode block
  // (first reads, workflow-only dispatch) is not in it, so a bound target is never deduped; nor do its companions or
  // the composite research block fall back to conditional pointers.
  const binds = (target: SkillPointerTarget): boolean =>
    target.bindingPattern?.test(visible) === true
  // A slash command ("/mass-ulw") is not a bare name, so it is invoked through its binding form.
  const invoked = TARGETS.filter((target) => target.pattern.test(visible) || binds(target))
  const massMode = invoked.some((target) => target.customType === MASS_ULW_CUSTOM_TYPE && binds(target))
  const pointers: SkillPointerMessage[] = invoked
    .filter((target) => binds(target) || !alreadyLoaded(target.skillName, target.expandedBlockPattern))
    .map((target) => ({
      customType: target.customType,
      content: binds(target) ? skillMode(target, massMode, sessionScope) : skillPointer(target, sessionScope),
    }))
  for (const parent of invoked) {
    for (const companion of parent.companions ?? []) {
      if (alreadyLoaded(companion.skillName, companion.expandedBlockPattern)) continue
      if (pointers.some((pointer) => pointer.customType === companion.customType)) continue
      pointers.push({ customType: companion.customType, content: companionPointer(parent, companion, binds(parent)) })
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

// Native ships the loop as an eval SDK, not a tool or a CLI. The SDK binds the session from the
// host env, so the scope here is informational: it tells the model where this session's state lives.
function ulwLoopToolSentence(sessionScope: string | null): string {
  const base = ' Drive every ulw-loop operation from a JS eval cell through the SDK: const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`); never call a tool named omo_agent_toolkit and never spawn a CLI.'
  if (sessionScope === null) return base
  return `${base} This session's state lives under .omo/ulw-loop/${sessionScope}/.`
}

// A keyword proves a mention, not a request to run the workflow.
function skillPointer(target: SkillPointerTarget, sessionScope: string | null): string {
  const skillsRoot = getBuiltinSkillsRoot()
  const extra = target.extra?.(sessionScope) ?? ""
  return `<omo-${target.skillName}-pointer>This message mentions ${target.skillName}. If the user of this session is asking to run ${target.skillName}, read the ${target.skillName} skill at ${skillsRoot}${target.skillName}/SKILL.md with the read tool and follow it: ${target.instruction}. If ${target.skillName} is only being discussed, quoted, or relayed from another session, ignore this pointer.${extra}</omo-${target.skillName}-pointer>`
}

// Reached only for a binding form (see `bindingForms`) in text that survived the quote, relay, negation,
// identifier, child-session and extension filters, so the block states the mode as settled and names the
// first reads and the dispatch shape that satisfy it.
function skillMode(target: SkillPointerTarget, massMode: boolean, sessionScope: string | null): string {
  const skillsRoot = getBuiltinSkillsRoot()
  const extra = target.extra?.(sessionScope) ?? ""
  const tag = `omo-${target.skillName}-mode`
  const reads =
    target.customType === MASS_ULW_CUSTOM_TYPE
      ? `${skillsRoot}${target.skillName}/SKILL.md and its references/planning.md`
      : `${skillsRoot}${target.skillName}/SKILL.md`
  const dispatch =
    target.customType === MASS_ULW_CUSTOM_TYPE
      ? " The work runs as workflow runs started from an eval cell, their nodes executing in dependency-ordered waves; doing the job inline, or through one-off task spawns in place of workflow runs, does not satisfy this request. Where the ultrawork directive's general delegation guidance differs, this mode decides how lanes are dispatched."
      : massMode
        ? " mass-ulw mode is active in the same message, so run the research waves as its workflow runs."
        : ""
  return `<${tag}>The user of this session invoked ${target.skillName} in their own words, so this turn runs in ${target.skillName} mode. This is binding: the block is produced only for the skill's slash command or a prompt that opens with a request to run it. Before any other tool call this turn, read ${reads} in full with the read tool, then follow the skill: ${target.instruction}.${dispatch}${extra}</${tag}>`
}

function companionPointer(parent: SkillPointerTarget, companion: SkillCompanion, binding: boolean): string {
  const skillsRoot = getBuiltinSkillsRoot()
  if (binding) {
    return `<omo-${companion.skillName}-pointer>${parent.skillName} ${companion.role}. Read the ${companion.skillName} skill at ${skillsRoot}${companion.skillName}/SKILL.md with the read tool in the same turn as the ${parent.skillName} skill and ${companion.instruction}.</omo-${companion.skillName}-pointer>`
  }
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

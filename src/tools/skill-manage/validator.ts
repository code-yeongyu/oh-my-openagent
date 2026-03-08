import { parseFrontmatter } from "../../shared/frontmatter"
import { createBuiltinSkills } from "../../features/builtin-skills/skills"
import {
  discoverGlobalAgentsSkills,
  discoverOpencodeGlobalSkills,
  discoverUserClaudeSkills,
} from "../../features/opencode-skill-loader/loader"
import { scanSkillContent } from "./security-scanner"

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

const BUILTIN_PROTECTED_NAMES = new Set([
  "git-master",
  "playwright",
  "dev-browser",
  "frontend-ui-ux",
  "playwright-cli",
  "agent-browser",
])

export interface ValidateSkillWriteInput {
  name: string
  content: string
  scope: "project" | "user"
}

export interface ValidateSkillWriteResult {
  warnings: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

async function collectNonProjectSkillNames(): Promise<Set<string>> {
  const [configSkills, userClaudeSkills, userAgentsSkills] = await Promise.all([
    discoverOpencodeGlobalSkills(),
    discoverUserClaudeSkills(),
    discoverGlobalAgentsSkills(),
  ])

  const builtinSkills = createBuiltinSkills()
  const names = new Set<string>()

  for (const skill of [...configSkills, ...userClaudeSkills, ...userAgentsSkills, ...builtinSkills]) {
    names.add(skill.name)
  }

  return names
}

export async function validateSkillWrite(input: ValidateSkillWriteInput): Promise<ValidateSkillWriteResult> {
  if (!SKILL_NAME_REGEX.test(input.name)) {
    throw new Error("Invalid skill name. Use lowercase kebab-case: ^[a-z0-9]+(-[a-z0-9]+)*$")
  }

  if (BUILTIN_PROTECTED_NAMES.has(input.name)) {
    throw new Error(`Skill name \"${input.name}\" is reserved for builtin skills`)
  }

  let frontmatterResult: ReturnType<typeof parseFrontmatter<Record<string, unknown>>>
  try {
    frontmatterResult = parseFrontmatter<Record<string, unknown>>(input.content)
  } catch {
    throw new Error("Failed to parse skill frontmatter")
  }

  if (frontmatterResult.parseError) {
    throw new Error("Invalid YAML frontmatter")
  }

  if (!isNonEmptyString(frontmatterResult.data.description)) {
    throw new Error("Skill frontmatter requires a non-empty description field")
  }

  const security = scanSkillContent(input.content)
  if (security.blockedReasons.length > 0) {
    throw new Error(`Security policy blocked this skill: ${security.blockedReasons.join("; ")}`)
  }

  const warnings = [...security.warnings]
  const nonProjectSkillNames = await collectNonProjectSkillNames()

  if (input.scope === "project" && nonProjectSkillNames.has(input.name)) {
    warnings.push(`Creating project skill \"${input.name}\" will shadow a lower-scope skill`)
  }

  if (input.scope === "user" && createBuiltinSkills().some((skill) => skill.name === input.name)) {
    warnings.push(`Creating user skill \"${input.name}\" will shadow builtin skill \"${input.name}\"`)
  }

  return { warnings }
}

export { BUILTIN_PROTECTED_NAMES, SKILL_NAME_REGEX }

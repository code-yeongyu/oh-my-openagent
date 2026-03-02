import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { getAllSkills, clearSkillCache } from "../../features/opencode-skill-loader/skill-content"
import { createBuiltinSkills } from "../../features/builtin-skills/skills"
import { discoverOpencodeGlobalSkills, discoverUserClaudeSkills, discoverGlobalAgentsSkills } from "../../features/opencode-skill-loader/loader"
import { clearSkillToolCaches } from "../skill"
import type { SkillManageInput, SkillManageResult } from "./types"
import { SKILL_NAME_REGEX, validateSkillWrite } from "./validator"

function resolveGitRoot(directory: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" })
  if (result.status !== 0) return null
  const root = result.stdout.trim()
  return root.length > 0 ? root : null
}

function resolveScope(scope: "project" | "user" | undefined, directory: string): "project" | "user" {
  if (scope) return scope
  return resolveGitRoot(directory) ? "project" : "user"
}

function resolveSkillPath(scope: "project" | "user", directory: string, name: string): string {
  const gitRoot = resolveGitRoot(directory)
  if (scope === "project") {
    return join(gitRoot ?? directory, ".opencode", "skills", `${name}.md`)
  }
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "skills", `${name}.md`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(tempPath, content, "utf8")
  await fs.rename(tempPath, path)
}

async function mutationWarningsForDelete(name: string, scope: "project" | "user"): Promise<string[]> {
  if (scope === "user") {
    return createBuiltinSkills().some((skill) => skill.name === name)
      ? [`Deleting user skill \"${name}\" will unshadow builtin skill \"${name}\"`]
      : []
  }

  const [configSkills, userClaudeSkills, userAgentsSkills] = await Promise.all([
    discoverOpencodeGlobalSkills(),
    discoverUserClaudeSkills(),
    discoverGlobalAgentsSkills(),
  ])
  const builtinSkills = createBuiltinSkills()
  const lowerScoped = [...configSkills, ...userClaudeSkills, ...userAgentsSkills, ...builtinSkills]
    .filter((skill) => skill.name === name)
    .map((skill) => skill.name)

  return lowerScoped.length > 0
    ? [`Deleting project skill \"${name}\" will unshadow lower-scope skill(s)`]
    : []
}

async function invalidateSkillCaches(): Promise<void> {
  clearSkillCache()
  clearSkillToolCaches()
}

function requireName(name: string | undefined): string {
  if (!name) throw new Error("name is required for this operation")
  return name
}

function requireContent(content: string | undefined): string {
  if (typeof content !== "string") throw new Error("content is required for this operation")
  return content
}

export function createSkillManageTool(ctx: PluginInput): ToolDefinition {
  const serialize = (result: SkillManageResult): string => JSON.stringify(result, null, 2)

  return tool({
    description: "Manage skills: create, edit, delete, list, and read skill files",
    args: {
      op: tool.schema.enum(["create", "edit", "delete", "list", "read"]).describe("Operation to perform"),
      name: tool.schema.string().optional().describe("Skill name (kebab-case)"),
      content: tool.schema.string().optional().describe("Full skill markdown content for create/edit"),
      scope: tool.schema.enum(["project", "user"]).optional().describe("Target scope for mutations"),
    },
    async execute(args: SkillManageInput): Promise<string> {
      if (args.op === "list") {
        const skills = await getAllSkills({ directory: ctx.directory })
        return serialize({
          op: "list",
          skills: skills.map((skill) => ({
            name: skill.name,
            scope: skill.scope,
            path: skill.path,
            description: skill.definition.description || "",
          })),
        })
      }

      if (args.op === "read") {
        const name = requireName(args.name)
        if (!SKILL_NAME_REGEX.test(name)) {
          throw new Error("Invalid skill name. Use lowercase kebab-case: ^[a-z0-9]+(-[a-z0-9]+)*$")
        }
        const skills = await getAllSkills({ directory: ctx.directory })
        const found = skills.find((skill) => skill.name === name)
        if (!found) throw new Error(`Skill \"${name}\" not found`)
        const content = found.path ? await fs.readFile(found.path, "utf8") : (found.definition.template || "")
        return serialize({ op: "read", name: found.name, scope: found.scope, path: found.path, content })
      }

      const name = requireName(args.name)
      const scope = resolveScope(args.scope, ctx.directory)
      if (!SKILL_NAME_REGEX.test(name)) {
        throw new Error("Invalid skill name. Use lowercase kebab-case: ^[a-z0-9]+(-[a-z0-9]+)*$")
      }

      const targetPath = resolveSkillPath(scope, ctx.directory, name)

      if (args.op === "delete") {
        if (!(await fileExists(targetPath))) throw new Error(`Skill \"${name}\" not found at ${scope} scope`)
        const warnings = await mutationWarningsForDelete(name, scope)
        await fs.unlink(targetPath)
        await invalidateSkillCaches()
        return serialize({ op: "delete", name, scope, path: targetPath, warnings })
      }

      const content = requireContent(args.content)
      const { warnings } = await validateSkillWrite({ name, content, scope })

      if (args.op === "create") {
        if (await fileExists(targetPath)) throw new Error(`Skill \"${name}\" already exists at ${scope} scope`)
        await writeAtomic(targetPath, content)
        await invalidateSkillCaches()
        return serialize({ op: "create", name, scope, path: targetPath, warnings })
      }

      if (!(await fileExists(targetPath))) throw new Error(`Skill \"${name}\" not found at ${scope} scope`)
      await writeAtomic(targetPath, content)
      await invalidateSkillCaches()
      return serialize({ op: "edit", name, scope, path: targetPath, warnings })
    },
  })
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Skill, type Plugin } from "@opencode/plugin"
import { createBuiltinSkills } from "@oh-my-opencode/skills-loader-core"
import type { OhMyOpenCodeConfig } from "./config"
import { loadBuiltinCommands } from "./features/builtin-commands/commands"
import { createBuiltinMcps } from "./mcp/index"

export function renderCommandTemplate(
  template: string,
  args: { sessionID: string; argsText: string },
): string {
  return template
    .split("$ARGUMENTS").join(args.argsText)
    .split("$SESSION_ID").join(args.sessionID)
    .split("$TIMESTAMP").join(String(Date.now()))
}

export function materializeSkillTemplate(directory: string, name: string, template: string): string {
  const path = join(directory, ".omo", "skills", name, "SKILL.md")
  let existing: string | undefined
  try {
    existing = readFileSync(path, "utf8")
  } catch {
    existing = undefined
  }
  if (existing !== template) {
    mkdirSync(join(directory, ".omo", "skills", name), { recursive: true })
    writeFileSync(path, template)
  }
  return path
}

export async function registerSkillsV2(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
): Promise<void> {
  const directory = ctx.location.directory
  const skills = createBuiltinSkills({
    disabledSkills: pluginConfig.disabled_skills
      ? new Set(pluginConfig.disabled_skills)
      : undefined,
    teamModeEnabled: pluginConfig.team_mode?.enabled ?? false,
  })
  await ctx.skill.transform((editor) => {
    for (const skill of skills) {
      if (editor.get(skill.name)) continue
      editor.add({
        id: skill.name as Skill.ID,
        name: skill.name as Skill.Name,
        description: skill.description,
        path: materializeSkillTemplate(directory, skill.name, skill.template) as Skill.Info["path"],
        content: skill.template,
      })
    }
  })
}

export async function registerCommandsV2(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
): Promise<void> {
  const commands = loadBuiltinCommands(pluginConfig.disabled_commands)
  await ctx.command.transform((editor) => {
    for (const [name, definition] of Object.entries(commands)) {
      editor.add({
        name,
        description: definition.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          const text = renderCommandTemplate(definition.template, {
            sessionID,
            argsText: prompt.text ?? "",
          })
          await ctx.session.prompt({ ...prompt, sessionID, text, delivery })
        },
      })
    }
  })
}

export async function registerMcpV2(
  ctx: Plugin.Context,
  pluginConfig: OhMyOpenCodeConfig,
  directory: string,
): Promise<void> {
  const mcps = createBuiltinMcps(pluginConfig.disabled_mcps ?? [], undefined, { cwd: directory })
  await ctx.mcp.transform((editor) => {
    for (const [name, config] of Object.entries(mcps)) {
      if (editor.get(name)) continue
      if (config.type === "remote") {
        editor.set(name, {
          type: "remote",
          url: config.url,
          ...(config.headers ? { headers: config.headers } : {}),
          disabled: !config.enabled,
        })
      } else {
        editor.set(name, {
          type: "local",
          command: config.command,
          ...(config.cwd ? { cwd: config.cwd } : {}),
          ...(config.environment ? { environment: config.environment } : {}),
          disabled: !config.enabled,
        })
      }
    }
  })
}

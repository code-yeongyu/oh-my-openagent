import { existsSync, readdirSync, readFileSync } from "fs"
import { basename, join } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { isMarkdownFile } from "../../shared/file-utils"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { log } from "../../shared/logger"
import type { CommandDefinition, CommandFrontmatter } from "../claude-code-command-loader/types"
import type { LoadedPlugin } from "./types"

export function loadPluginCommands(plugins: LoadedPlugin[]): Record<string, CommandDefinition> {
  const commands: Record<string, CommandDefinition> = {}

  for (const plugin of plugins) {
    if (!plugin.commandsDir || !existsSync(plugin.commandsDir)) continue

    const entries = readdirSync(plugin.commandsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!isMarkdownFile(entry)) continue

      const commandPath = join(plugin.commandsDir, entry.name)
      const commandName = basename(entry.name, ".md")
      const namespacedName = `${plugin.name}:${commandName}`

      try {
        const content = readFileSync(commandPath, "utf-8")
        const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

        const wrappedTemplate = `<command-instruction>\n${body.trim()}\n</command-instruction>\n\n<user-request>\n$ARGUMENTS\n</user-request>`
        const formattedDescription = `(plugin: ${plugin.name}) ${data.description || ""}`

        const definition = {
          name: namespacedName,
          description: formattedDescription,
          template: wrappedTemplate,
          agent: data.agent,
          model: sanitizeModelField(data.model, "claude-code"),
          subtask: data.subtask,
          argumentHint: data["argument-hint"],
        }

        const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = definition
        commands[namespacedName] = openCodeCompatible as CommandDefinition

        log(`Loaded plugin command: ${namespacedName}`, { path: commandPath })
      } catch (error) {
        log(`Failed to load plugin command: ${commandPath}`, error)
      }
    }
  }

  return commands
}

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { discoverAllSkills, type LoadedSkill } from "../../features/opencode-skill-loader"
import type { CommandInfo, SlashcommandToolOptions } from "./types"
import { discoverCommandsSync } from "./command-discovery"
import { buildDescriptionFromItems, TOOL_DESCRIPTION_PREFIX } from "./slashcommand-description"
import { formatCommandList, formatLoadedCommand } from "./command-output-formatter"
import { skillToCommandInfo } from "./skill-command-converter"

export function createSlashcommandTool(options: SlashcommandToolOptions = {}): ToolDefinition {
  let cachedCommands: CommandInfo[] | null = options.commands ?? null
  let cachedSkills: LoadedSkill[] | null = options.skills ?? null
  let cachedDescription: string | null = null

  const getCommands = (): CommandInfo[] => {
    if (cachedCommands) return cachedCommands
    cachedCommands = discoverCommandsSync()
    return cachedCommands
  }

  const getSkills = async (): Promise<LoadedSkill[]> => {
    if (cachedSkills) return cachedSkills
    cachedSkills = await discoverAllSkills()
    return cachedSkills
  }

  const getAllItems = async (): Promise<CommandInfo[]> => {
    const commands = getCommands()
    const skills = await getSkills()
    return [...commands, ...skills.map(skillToCommandInfo)]
  }

  const buildDescription = async (): Promise<string> => {
    if (cachedDescription) return cachedDescription
    const allItems = await getAllItems()
    cachedDescription = buildDescriptionFromItems(allItems)
    return cachedDescription
  }

  if (options.commands !== undefined && options.skills !== undefined) {
    const allItems = [...options.commands, ...options.skills.map(skillToCommandInfo)]
    cachedDescription = buildDescriptionFromItems(allItems)
  } else {
    void buildDescription()
  }

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },

    args: {
      command: tool.schema
        .string()
        .describe(
          "The slash command name (without leading slash). E.g., 'publish', 'commit', 'plan'"
        ),
      user_message: tool.schema
        .string()
        .optional()
        .describe(
          "Optional arguments or context to pass to the command. E.g., for '/publish patch', command='publish' user_message='patch'"
        ),
    },

    async execute(args) {
      const allItems = await getAllItems()

      if (!args.command) {
        return formatCommandList(allItems) + "\n\nProvide a command or skill name to execute."
      }

      const commandName = args.command.replace(/^\//, "")

      const exactMatch = allItems.find(
        (command) => command.name.toLowerCase() === commandName.toLowerCase()
      )

      if (exactMatch) {
        return await formatLoadedCommand(exactMatch, args.user_message)
      }

      const partialMatches = allItems.filter((command) =>
        command.name.toLowerCase().includes(commandName.toLowerCase())
      )

      if (partialMatches.length > 0) {
        const matchList = partialMatches.map((command) => `/${command.name}`).join(", ")
        return `No exact match for "/${commandName}". Did you mean: ${matchList}?\n\n${formatCommandList(allItems)}`
      }

      return commandName.includes(":") 
        ? `Marketplace plugin commands like "/${commandName}" are not supported. Use .claude/commands/ for custom commands.\n\n${formatCommandList(allItems)}`
        : `Command or skill "/${commandName}" not found.\n\n${formatCommandList(allItems)}\n\nTry a different name.`
    },
  })
}

export const slashcommand: ToolDefinition = createSlashcommandTool()

/**
 * What a host needs to register computer use before loading its implementation (#9113): settings, the
 * tool definitions and permission parsers, `/computer`, and the skill. Nothing here reaches the desktop
 * service or the engine, so a bundle importing only this entry stays free of them.
 */
export { COMPUTER_COMMAND_USAGE, COMPUTER_SUBCOMMANDS, type ComputerSubcommand, runComputerCommand } from "./command";
export {
	COMPUTER_ACTIONS_TOOL_NAME,
	computerActionsPermissionParser,
	computerActionsToolDefinition,
} from "./cua-definition";
export { defaultStopHotkey, isSupportedHost } from "./host-policy";
export { COMPUTER_PERMISSION, computerPermissionParser, computerTier, type PermissionRequest } from "./permission";
export type { ComputerHostContext } from "./session";
export {
	type ComputerSettings,
	ComputerSettingsError,
	type ComputerSettingsInput,
	ComputerSettingsSchema,
	resolveComputerSettings,
} from "./settings";
export { COMPUTER_SKILL_NAME, computerSkillMarkdown, materializeComputerSkill } from "./skill";
export { COMPUTER_TOOL_NAME, computerToolDefinition } from "./tool-definition";

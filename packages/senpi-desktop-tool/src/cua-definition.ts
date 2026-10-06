import { ComputerActionsParams, isReadOnlyActions } from "./cua-actions";
import { COMPUTER_PERMISSION, type PermissionRequest } from "./permission";

export const COMPUTER_ACTIONS_TOOL_NAME = "computer_actions";

const DESCRIPTION = [
	"Drive the user's real desktop with OpenAI computer-use actions (experimental): screenshot, click, double_click, move, drag, scroll, type, keypress, wait, or a batch of them.",
	"x,y are pixels of the latest screenshot. A batch stops at the first failed action; an in-batch screenshot becomes the frame for the actions after it.",
	"Pass only the fields the chosen action takes (each field's description names its actions); anything else is refused with COMPUTER_INVALID_ARGUMENTS before any input.",
	"Errors carry COMPUTER_* codes with a recovery hint. COMPUTER_SUSPENDED or COMPUTER_SUPERVISOR_NOT_LIVE means the user stopped you: stop and wait.",
].join("\n");

/** Rules `computer:read` / `computer:exec` apply, exactly as for the `computer` tool. */
export function computerActionsPermissionParser(
	_toolName: string,
	input: Record<string, unknown>,
	_cwd: string,
): PermissionRequest[] {
	const tier = isReadOnlyActions(input) ? "read" : "exec";
	return [{ permission: COMPUTER_PERMISSION, patterns: [tier], always: [tier] }];
}

/** The `computer_actions` tool without `execute`, registrable before the implementation loads (#9113). */
export const computerActionsToolDefinition = {
	name: COMPUTER_ACTIONS_TOOL_NAME,
	label: "Computer actions",
	description: DESCRIPTION,
	exposure: "search" as const,
	searchText: "OpenAI computer-use actions (experimental): screenshot, click, type, keypress, scroll, drag, batch",
	searchKeywords: ["computer use", "cua", "openai computer", "click", "screenshot", "keypress"],
	searchGroup: "desktop",
	parameters: ComputerActionsParams,
	executionMode: "sequential" as const,
};

import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI } from "../../../types.ts";
import { getTodoResultLines, type TodoItem, type TodoWriteDetails } from "../state.ts";

const TodoReadParams = Type.Object({});

export function registerTodoReadTool(pi: ExtensionAPI, getCurrentTodos: () => TodoItem[]): void {
	pi.registerTool({
		name: "todoread",
		label: "TodoRead",
		description: "Read the current structured task list for the current coding session.",
		promptSnippet: "Read the current todo list for the active coding session.",
		promptGuidelines: [
			"Use this tool when you need the current todo list before deciding how to update it.",
			"This tool returns the latest session todo list managed by todowrite.",
		],
		parameters: TodoReadParams,
		async execute() {
			const currentTodos = getCurrentTodos();
			return {
				content: [{ type: "text", text: JSON.stringify(currentTodos, null, 2) }],
				details: { todos: currentTodos } satisfies TodoWriteDetails,
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("todoread")), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TodoWriteDetails | undefined;
			const todos = details?.todos ?? getCurrentTodos();
			const lines = getTodoResultLines(todos);
			const title = lines[0] ?? "0 todos";
			const items = lines.slice(1);
			const body = items.length > 0 ? `\n${items.join("\n")}` : "";
			return new Text(`${theme.fg("muted", title)}${body}`, 0, 0);
		},
	});
}

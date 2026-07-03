import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../../types.ts";
import {
	getTodoResultLines,
	TODO_STATE_ENTRY_TYPE,
	type TodoItem,
	type TodoStateEntry,
	type TodoWriteDetails,
} from "../state.ts";

const DESCRIPTION = `Use this tool to create and manage a structured task list for tracking progress on multi-step work.

<todo_format>
## Todo Format (MANDATORY)

Each todo title MUST encode four elements: WHERE, WHY, HOW, and EXPECTED RESULT.

Format: "[WHERE] [HOW] to [WHY] - expect [RESULT]"

GOOD:
- "src/utils/validation.ts: Add validateEmail() for input sanitization - returns boolean"
- "UserService.create(): Call validateEmail() before DB insert - rejects invalid emails with 400"
- "validation.test.ts: Add test for missing @ sign - expect validateEmail('foo') to return false"

BAD:
- "Implement email validation" (where? how? what result?)
- "Add dark mode" (feature, not a todo)
- "Fix auth" (what file? what changes? what's expected?)
</todo_format>

<granularity_rules>
## Granularity Rules

Each todo MUST be a single atomic action completable in 1-3 tool calls. If it needs more, split it.

**Size test**: Can you complete this todo by editing one file or running one command? If not, it's too big.
</granularity_rules>

<task_management>
## Task Management
- One in_progress at a time. Complete it before starting the next.
- Mark completed immediately after finishing each item.
- ALWAYS use todos. No "trivial task" exemptions.
</task_management>`;

const TodoItemSchema = Type.Object({
	content: Type.String({
		description:
			"Todo title encoding WHERE, WHY, HOW, and EXPECTED RESULT. Format: '[WHERE] [HOW] to [WHY] - expect [RESULT]'. Must be a single atomic action completable in 1-3 tool calls.",
	}),
	status: Type.String({
		description:
			"Current status: pending (not started), in_progress (currently working - limit ONE at a time), completed (finished - mark IMMEDIATELY after done), cancelled (no longer needed)",
	}),
	priority: Type.String({
		description:
			"Priority level: high (blocking or critical path), medium (important but not blocking), low (nice to have)",
	}),
});

const TodoWriteParams = Type.Object({
	todos: Type.Array(TodoItemSchema, {
		description: "The updated todo list",
		minItems: 1,
	}),
});

type TodoAccessors = {
	getCurrentTodos: () => TodoItem[];
	setCurrentTodos: (todos: TodoItem[]) => void;
	syncWidget: (ctx: ExtensionContext) => void;
};

export function registerTodoWriteTool(pi: ExtensionAPI, accessors: TodoAccessors): void {
	pi.registerTool({
		name: "todowrite",
		label: "TodoWrite",
		description: DESCRIPTION,
		promptSnippet:
			"MANDATORY for ALL tasks. Follow EXPLORE -> DEFINE -> PLAN -> TODO -> EXECUTE workflow. No exceptions.",
		promptGuidelines: [
			"Create todos for EVERY task. No 'trivial task' exemptions. Follow EXPLORE -> DEFINE -> PLAN -> TODO -> EXECUTE workflow always.",
			"Each todo title MUST encode WHERE, WHY, HOW, and EXPECTED RESULT. Format: '[WHERE] [HOW] to [WHY] - expect [RESULT]'. Vague todos are useless.",
			"Each todo MUST be a single atomic action completable in 1-3 tool calls. If bigger, split it. Size test: one file edit or one command.",
			"Pass the complete updated todo list on every call instead of incremental operations.",
			"Exactly ONE todo with status in_progress at any time. Mark completed IMMEDIATELY after finishing - NEVER batch completions.",
			"OBSESSIVELY TRACK YOUR WORK. Every step gets a todo. Every completion gets marked immediately. No evidence = not complete.",
		],
		parameters: TodoWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const currentTodos = params.todos.map((todo) => ({ ...todo }));
			accessors.setCurrentTodos(currentTodos);
			pi.appendEntry(TODO_STATE_ENTRY_TYPE, { todos: currentTodos } satisfies TodoStateEntry);
			accessors.syncWidget(ctx);

			return {
				content: [{ type: "text", text: JSON.stringify(currentTodos, null, 2) }],
				details: { todos: currentTodos } satisfies TodoWriteDetails,
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("todowrite ")) + theme.fg("muted", `${args.todos.length} item(s)`),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TodoWriteDetails | undefined;
			const todos = details?.todos ?? accessors.getCurrentTodos();
			const lines = getTodoResultLines(todos);
			const title = lines[0] ?? "0 todos";
			const items = lines.slice(1);
			const body = items.length > 0 ? `\n${items.join("\n")}` : "";
			return new Text(`${theme.fg("muted", title)}${body}`, 0, 0);
		},
	});
}

import { normalizeSDKResponse } from "../../shared";

import { logCompletionWait } from "./completion-wait-log";
import type { RunContext, Todo } from "./types";

export async function areAllTodosComplete(ctx: RunContext): Promise<boolean> {
	const todosRes = await ctx.client.session.todo({
		path: { id: ctx.sessionID },
		query: { directory: ctx.directory },
	});
	const todos = normalizeSDKResponse(todosRes, [] as Todo[]);

	const incompleteTodos = todos.filter(
		(todo) => todo.status !== "completed" && todo.status !== "cancelled",
	);

	if (incompleteTodos.length > 0) {
		logCompletionWait(ctx, `${incompleteTodos.length} todos remaining`);
		return false;
	}

	return true;
}

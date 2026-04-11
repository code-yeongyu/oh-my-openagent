import { normalizeSDKResponse } from "../../shared";

import { logCompletionWait } from "./completion-wait-log";
import type { ChildSession, RunContext, SessionStatus } from "./types";

export async function areAllChildrenIdle(ctx: RunContext): Promise<boolean> {
	const allStatuses = await fetchAllStatuses(ctx);
	return areAllDescendantsIdle(ctx, ctx.sessionID, allStatuses);
}

async function fetchAllStatuses(
	ctx: RunContext,
): Promise<Record<string, SessionStatus>> {
	const statusRes = await ctx.client.session.status({
		query: { directory: ctx.directory },
	});
	return normalizeSDKResponse(statusRes, {} as Record<string, SessionStatus>);
}

async function areAllDescendantsIdle(
	ctx: RunContext,
	sessionID: string,
	allStatuses: Record<string, SessionStatus>,
): Promise<boolean> {
	const childrenRes = await ctx.client.session.children({
		path: { id: sessionID },
		query: { directory: ctx.directory },
	});
	const children = normalizeSDKResponse(childrenRes, [] as ChildSession[]);

	for (const child of children) {
		const status = allStatuses[child.id];
		if (status && status.type !== "idle") {
			logCompletionWait(
				ctx,
				`session ${child.id.slice(0, 8)}... is ${status.type}`,
			);
			return false;
		}

		const descendantsIdle = await areAllDescendantsIdle(
			ctx,
			child.id,
			allStatuses,
		);
		if (!descendantsIdle) {
			return false;
		}
	}

	return true;
}

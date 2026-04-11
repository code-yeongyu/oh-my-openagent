import pc from "picocolors";

import type { RunContext } from "./types";

export function logCompletionWait(ctx: RunContext, message: string): void {
	if (!ctx.verbose) {
		return;
	}

	console.log(pc.dim(`  Waiting: ${message}`));
}

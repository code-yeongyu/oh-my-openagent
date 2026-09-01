import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { codegraphDataRoot } from "../../../../../utils/src/codegraph/paths.ts";
import type { CodegraphSessionStartOutcome } from "./hook-types.js";

export function appendSessionStartOutcome(
	homeDir: string,
	outcome: CodegraphSessionStartOutcome,
	nowMs: number = Date.now(),
): void {
	const path = join(codegraphDataRoot(homeDir), "session-start.jsonl");
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify({ ...outcome, timestamp: new Date(nowMs).toISOString() })}\n`);
}

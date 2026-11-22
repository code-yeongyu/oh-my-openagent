import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasCode } from "./plan-log.js";

// The loop advertises `.omo/evidence` as the place for QA artifacts, which land in the user's own
// repository and can grow to gigabytes of screenshots and logs (#10799). A self-ignoring
// `.gitignore` inside that directory keeps every artifact out of `git status` without touching the
// repository's own ignore rules or anything else under `.omo/` the user may track.
export function ensureEvidenceIgnored(repoRoot: string): void {
	const root = join(repoRoot, ".omo", "evidence");
	mkdirSync(root, { recursive: true });
	try {
		writeFileSync(join(root, ".gitignore"), "*\n", { flag: "wx" });
	} catch (error) {
		if (!hasCode(error, "EEXIST")) throw error;
	}
}

import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasCode } from "./plan-log.js";

// The loop advertises `.omo/evidence` as the place for QA artifacts, which land in the user's own
// repository and can grow to gigabytes of screenshots and logs (#10799). A self-ignoring
// `.gitignore` inside that directory keeps untracked artifacts out of `git status` without touching the
// repository's own ignore rules or anything else under `.omo/` the user may track.
export function ensureEvidenceIgnored(repoRoot: string): void {
	const workspace = join(repoRoot, ".omo");
	const root = join(workspace, "evidence");
	try {
		if (!lstatSync(workspace).isDirectory()) throw new Error(".omo is not a real directory");
		try {
			mkdirSync(root);
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
		}
		if (!lstatSync(root).isDirectory()) throw new Error(".omo/evidence is not a real directory");
		try {
			writeFileSync(join(root, ".gitignore"), "*\n", { flag: "wx" });
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[ulw-loop] could not set up .omo/evidence/.gitignore: ${message}\n`);
	}
}

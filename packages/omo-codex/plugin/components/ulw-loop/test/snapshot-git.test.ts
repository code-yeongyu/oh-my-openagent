import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseGitPorcelainChangedFiles, summarizeChangedFiles } from "../src/snapshot.ts";
import { SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS } from "../src/types.ts";

describe("parseGitPorcelainChangedFiles", () => {
	it("#given porcelain status lines #when parsed #then uses only status and path data", () => {
		const summary = parseGitPorcelainChangedFiles([
			" M src/snapshot.ts",
			"R  old-name.ts -> src/new-name.ts",
			"?? test/snapshot.test.ts",
		]);

		expect(summary).toEqual({
			kind: "available",
			entries: [
				{ status: "M", path: "src/snapshot.ts", line: "M src/snapshot.ts" },
				{ status: "R", path: "src/new-name.ts", line: "R src/new-name.ts" },
				{ status: "??", path: "test/snapshot.test.ts", line: "?? test/snapshot.test.ts" },
			],
			truncated: false,
		});
	});

	it("#given malformed and overlong porcelain lines #when parsed #then ignores malformed lines and bounds output", () => {
		const longPath = `src/${"x".repeat(SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS + 60)}.ts`;
		const summary = parseGitPorcelainChangedFiles(["bad", ` M ${longPath}`]);

		expect(summary.kind).toBe("available");
		if (summary.kind !== "available") throw new Error("expected available summary");
		expect(summary.entries).toHaveLength(1);
		expect(summary.entries[0]?.line.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHANGED_FILE_LINE_CHARS);
	});
});

describe("summarizeChangedFiles", () => {
	it("#given a non-git repo #when summarizing changed files #then returns unavailable", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ulw-loop-nongit-"));
		try {
			const summary = await summarizeChangedFiles(dir);
			expect(summary.kind).toBe("unavailable");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("#given a git repo with current dirty state #when summarizing changed files #then returns current porcelain status", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ulw-loop-git-"));
		try {
			await runGit(dir, ["init"]);
			await runGit(dir, ["config", "user.email", "test@example.com"]);
			await runGit(dir, ["config", "user.name", "Test User"]);
			await runGit(dir, ["commit", "--allow-empty", "-m", "init"]);
			await runGit(dir, ["status", "--short"]);
			const file = join(dir, "current.txt");
			await writeFile(file, "dirty\n", "utf8");

			const summary = await summarizeChangedFiles(dir);

			expect(summary.kind).toBe("available");
			if (summary.kind !== "available") throw new Error("expected available summary");
			expect(summary.entries.map((entry) => entry.line)).toContain("?? current.txt");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

function runGit(cwd: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

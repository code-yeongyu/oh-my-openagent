// biome-ignore-all format: smoke test pulls verbatim JSON for structural assertion.
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readText(relative: string): Promise<string> {
	return readFile(join(repoRoot, relative), "utf8");
}

async function readJson(relative: string): Promise<unknown> {
	return JSON.parse(await readText(relative));
}

describe("package.json", () => {
	it("declares ESM + npm + Node >=20", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		expect(pkg["type"]).toBe("module");
		expect(pkg["packageManager"]).toBe("npm@11.12.1");
		expect((pkg["engines"] as Record<string, unknown>)["node"]).toBe(">=20.0.0");
	});

	it("exposes the omo binary pointing at dist/cli.js", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		const bin = pkg["bin"] as Record<string, string>;
		expect(bin["omo"]).toBe("./dist/cli.js");
	});

	it("ships the expected files for npm publish", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		const files = pkg["files"] as readonly string[];
		expect(files).toContain("dist");
		expect(files).toContain("hooks");
		expect(files).toContain("skills");
		expect(files).not.toContain(".codex-plugin");
	});
});

describe("component plugin identity", () => {
	it("is owned by the aggregate OMO plugin root", async () => {
		await expect(readText(".codex-plugin/plugin.json")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("hooks/hooks.json", () => {
	it("registers UserPromptSubmit with PLUGIN_ROOT interpolation", async () => {
		const hooks = await readJson("hooks/hooks.json") as Record<string, unknown>;
		const events = (hooks["hooks"] as Record<string, unknown>)["UserPromptSubmit"] as readonly Record<string, unknown>[];
		expect(events.length).toBeGreaterThan(0);
		const command = ((events[0]?.["hooks"] as readonly Record<string, unknown>[])[0]?.["command"]) as string;
		expect(command).toContain(`$${"{PLUGIN_ROOT}"}`);
		expect(command).toContain("dist/cli.js");
		expect(command).toContain("hook user-prompt-submit");
	});
});

describe("src/cli.ts", () => {
	it("starts with #!/usr/bin/env node shebang", async () => {
		const text = await readText("src/cli.ts");
		expect(text.split("\n")[0]).toBe("#!/usr/bin/env node");
	});
});

describe("skills/ultragoal/SKILL.md", () => {
	it("exists", async () => {
		const info = await stat(join(repoRoot, "skills/ultragoal/SKILL.md"));
		expect(info.isFile()).toBe(true);
	});

	it("contains no omx references", async () => {
		const text = await readText("skills/ultragoal/SKILL.md");
		expect(text.toLowerCase()).not.toContain("omx");
	});

	it("references the success criteria and record-evidence vocabulary", async () => {
		const text = await readText("skills/ultragoal/SKILL.md");
		expect(text.toLowerCase()).toMatch(/success criteria|successcriteria/);
		expect(text.toLowerCase()).toContain("record-evidence");
	});

	it("uses the .omo workspace path", async () => {
		const text = await readText("skills/ultragoal/SKILL.md");
		expect(text).toContain(".omo/ultragoal");
	});
});

describe("source LOC budget", () => {
	it("every source file stays at or under 250 pure LOC", async () => {
		const files = [
			"src/types.ts", "src/paths.ts", "src/plan-io.ts", "src/plan-crud.ts", "src/goal-status.ts",
			"src/evidence.ts", "src/quality-gate.ts", "src/checkpoint.ts", "src/review-blockers.ts",
			"src/steering.ts", "src/codex-goal-instruction.ts", "src/codex-goal-snapshot.ts", "src/codex-hook.ts",
			"src/cli.ts", "src/cli-arg-parser.ts", "src/cli-output.ts", "src/cli-steering.ts", "src/cli-commands.ts",
		];
		for (const file of files) {
			const text = await readText(file);
			const pure = text.split("\n").filter((line) => {
				const trimmed = line.trim();
				return trimmed.length > 0 && !trimmed.startsWith("//");
			}).length;
			expect(pure, `${file} pure LOC`).toBeLessThanOrEqual(250);
		}
	});
});

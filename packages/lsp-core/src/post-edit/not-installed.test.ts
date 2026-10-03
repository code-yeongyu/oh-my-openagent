import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import {
	classifyPostEditFileLocation,
	collectPostEditDiagnostics,
	createPostEditNotConfiguredCache,
	type PostEditDiagnosticsOutcome,
	type PostEditFileLocation,
	resetPostEditNotConfiguredCache,
} from "./index.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

function touch(path: string, text = ""): string {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
	return path;
}

const FULL_NUDGE = [
	"LSP server 'typescript' for .ts is NOT INSTALLED.",
	"To install in THIS repository (preferred — no global install needed):",
	"ACTION REQUIRED — ASK THE USER whether to install this LSP server.",
].join("\n");

function notInstalled(
	serverId: string,
	overrides: Partial<Extract<PostEditDiagnosticsOutcome, { kind: "not_installed" }>> = {},
): PostEditDiagnosticsOutcome {
	return {
		kind: "not_installed",
		serverId,
		installDecisionTool: false,
		text: `${FULL_NUDGE} (${serverId})`,
		...overrides,
	};
}

function at(location: PostEditFileLocation): () => PostEditFileLocation {
	return () => location;
}

describe("classifyPostEditFileLocation", () => {
	it("#given a file with no workspace marker above it #when classified #then it is outside any project", () => {
		const root = tempRoot("lsp-postedit-noproject-");
		const file = touch(join(root, "scratch", "note.mjs"));

		expect(classifyPostEditFileLocation(file, { cwd: root, agentDirs: [], tempDirs: [] })).toBe("outside_project");
	});

	it("#given a file under the agent config dir inside a git repository #when classified #then the agent config dir wins", () => {
		const root = tempRoot("lsp-postedit-agentdir-");
		mkdirSync(join(root, ".git"));
		const agentDir = join(root, ".omo", "agent");
		const file = touch(join(agentDir, "models.json"), "{}\n");

		expect(classifyPostEditFileLocation(file, { cwd: root, agentDirs: [agentDir], tempDirs: [] })).toBe(
			"agent_config",
		);
	});

	it("#given a temp dir holding a stray package.json #when a scratch file there is classified #then it is a temp file", () => {
		const temp = tempRoot("lsp-postedit-temp-");
		touch(join(temp, "package.json"), "{}\n");
		const file = touch(join(temp, "rules_test.mjs"));

		expect(classifyPostEditFileLocation(file, { cwd: temp, agentDirs: [], tempDirs: [temp] })).toBe("temp");
	});

	it("#given the default temp dirs #when an OS temp file is classified #then the canonical temp dir matches", () => {
		const root = tempRoot("lsp-postedit-ostemp-");
		const file = touch(join(root, "scratch.mjs"));

		expect(classifyPostEditFileLocation(file, { cwd: root, agentDirs: [] })).toBe("temp");
		if (process.platform !== "win32") {
			const slashTmp = join("/tmp", `lsp-postedit-missing-${process.pid}`, "rules_test.mjs");
			expect(classifyPostEditFileLocation(slashTmp, { cwd: root, agentDirs: [] })).toBe("temp");
		}
	});

	for (const marker of ["package.json", ".git"] as const) {
		it(`#given a ${marker} directly in HOME #when a home-level file is classified #then HOME is not its project`, () => {
			const home = tempRoot("lsp-postedit-home-");
			if (marker === ".git") mkdirSync(join(home, ".git"));
			else touch(join(home, marker), "{}\n");
			const topLevel = touch(join(home, "notes.ts"));
			const nested = touch(join(home, "scratch", "draft.ts"));

			const options = { cwd: home, agentDirs: [], tempDirs: [], homeDirs: [home] };
			expect(classifyPostEditFileLocation(topLevel, options)).toBe("outside_project");
			expect(classifyPostEditFileLocation(nested, options)).toBe("outside_project");
		});
	}

	it("#given a marked HOME and a project under it #when a project file is classified #then it is still a project", () => {
		const home = tempRoot("lsp-postedit-homeproject-");
		mkdirSync(join(home, ".git"));
		touch(join(home, "work", "app", "package.json"), "{}\n");
		const file = touch(join(home, "work", "app", "src", "a.ts"));

		expect(classifyPostEditFileLocation(file, { cwd: home, agentDirs: [], tempDirs: [], homeDirs: [home] })).toBe(
			"project",
		);
	});

	it("#given a project with its own marker inside a temp dir #when classified #then it is a project", () => {
		const temp = tempRoot("lsp-postedit-tempproject-");
		const project = join(temp, "checkout");
		touch(join(project, "package.json"), "{}\n");
		const file = touch(join(project, "src", "a.ts"));

		expect(classifyPostEditFileLocation(file, { cwd: project, agentDirs: [], tempDirs: [temp] })).toBe("project");
		expect(classifyPostEditFileLocation("src/a.ts", { cwd: project, agentDirs: [], tempDirs: [temp] })).toBe(
			"project",
		);
	});
});

describe("collectPostEditDiagnostics not-installed guidance", () => {
	for (const location of ["outside_project", "agent_config", "temp"] as const) {
		it(`#given a missing server for a ${location} file #when diagnostics run #then the install nudge is skipped`, async () => {
			const result = await collectPostEditDiagnostics({
				filePaths: ["file.ts"],
				runDiagnostics: async () => notInstalled("typescript"),
				locateFile: at(location),
			});

			expect(result.blocks).toEqual([]);
			expect(result.observations).toEqual([{ filePath: "file.ts", kind: "not_installed" }]);
		});
	}

	it("#given a missing server for a project file #when diagnostics run #then today's full guidance is kept", async () => {
		const result = await collectPostEditDiagnostics({
			filePaths: ["src/a.ts"],
			runDiagnostics: async () => notInstalled("typescript"),
			locateFile: at("project"),
		});

		expect(result.blocks).toEqual([{ filePath: "src/a.ts", diagnostics: `${FULL_NUDGE} (typescript)` }]);
	});

	it("#given no decision tool #when repeated edits hit missing servers #then each server is nudged once per session", async () => {
		const cache = createPostEditNotConfiguredCache();
		const serverFor = (filePath: string): string => (filePath.endsWith(".json") ? "biome" : "typescript");
		const run = (filePaths: readonly string[]) =>
			collectPostEditDiagnostics({
				filePaths,
				cache,
				runDiagnostics: async (filePath) => notInstalled(serverFor(filePath)),
				locateFile: at("project"),
			});

		const first = await run(["a.ts", "b.ts"]);
		const second = await run(["c.ts", "d.json"]);
		const third = await run(["e.json", "f.ts"]);

		expect(first.blocks.map((block) => block.filePath)).toEqual(["a.ts"]);
		expect(second.blocks.map((block) => block.filePath)).toEqual(["d.json"]);
		expect(third.blocks).toEqual([]);

		resetPostEditNotConfiguredCache(cache);
		const afterReset = await run(["g.ts"]);
		expect(afterReset.blocks.map((block) => block.filePath)).toEqual(["g.ts"]);
	});

	it("#given a decision tool #when repeated edits hit a missing server #then every edit keeps the guidance", async () => {
		const cache = createPostEditNotConfiguredCache();
		const run = (filePath: string) =>
			collectPostEditDiagnostics({
				filePaths: [filePath],
				cache,
				runDiagnostics: async () => notInstalled("typescript", { installDecisionTool: true }),
				locateFile: at("project"),
			});

		expect((await run("a.ts")).blocks).toHaveLength(1);
		expect((await run("b.ts")).blocks).toHaveLength(1);
	});

	for (const decision of ["declined", "allowed"] as const) {
		it(`#given a recorded ${decision} decision #when edits repeat anywhere #then that branch's text is unchanged every time`, async () => {
			const cache = createPostEditNotConfiguredCache();
			const text = `LSP server 'typescript' ${decision} branch text`;
			const outcomes: PostEditFileLocation[] = ["project", "outside_project", "project"];
			const blocks: string[] = [];
			for (const location of outcomes) {
				const result = await collectPostEditDiagnostics({
					filePaths: ["a.ts"],
					cache,
					runDiagnostics: async () => notInstalled("typescript", { decision, text }),
					locateFile: at(location),
				});
				blocks.push(...result.blocks.map((block) => block.diagnostics));
			}

			expect(blocks).toEqual([text, text, text]);
		});
	}

	it("#given no file locator #when a missing server is reported #then the full guidance is kept", async () => {
		const result = await collectPostEditDiagnostics({
			filePaths: ["a.ts"],
			runDiagnostics: async () => notInstalled("typescript"),
		});

		expect(result.blocks).toEqual([{ filePath: "a.ts", diagnostics: `${FULL_NUDGE} (typescript)` }]);
	});
});

import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { __resetBunCommandProbeCacheForTests } from "../lsp/bun-project-checks.js";
import { createFakeBun, createProject, type FakeBun, removeFakeBunFixtures } from "../lsp/fake-bun-test-support.js";
import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { runBunDirectoryDiagnostics } from "./bun-directory-diagnostics.js";
import { executeLspDiagnostics } from "./diagnostics.js";
import type { LspDiagnosticsDetails } from "./types.js";

afterEach(() => {
	__resetBunCommandProbeCacheForTests();
	removeFakeBunFixtures();
});

const CHECK_ERROR = "src/x.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const LINT_REPORT = (root: string) =>
	JSON.stringify([{ filePath: join(root, "src", "x.ts"), messages: [{ ruleId: "prefer-const", severity: 2, message: "Use const", line: 1, column: 1 }] }]);

function diagnose(root: string, bun: FakeBun) {
	return runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
		executeLspDiagnostics({ filePath: root, severity: "all" }, undefined, { resolveBun: () => bun.path }),
	);
}

function commandsRun(bun: FakeBun): string[] {
	return bun.calls().map((call) => call.args.join(" "));
}

describe("lsp_diagnostics on a directory of a Bun project", () => {
	it("#given a Bun project and a bun with check #when diagnosed #then bun check is the typecheck", async () => {
		const root = createProject({ "bun.lock": "", "src/x.ts": 'const n: number = "s";\n' });
		const bun = createFakeBun({ commands: ["check"], checkStdout: CHECK_ERROR, checkExitCode: 1 });

		const result = await diagnose(root, bun);
		const details = result.details as LspDiagnosticsDetails;

		expect(result.content[0]?.text).toContain("Typecheck: bun check");
		expect(result.content[0]?.text).toContain(`${join(root, "src", "x.ts")}: error[bun check] (TS2322) at 1:6:`);
		expect(details.totalDiagnostics).toBe(1);
		expect(details.projectCommands).toEqual(["bun check"]);
		expect(commandsRun(bun)).toEqual(["check --help", "check --no-pretty .", "lint --help"]);
	});

	it("#given a bun without lint #when diagnosed #then lint is neither run nor reported", async () => {
		const root = createProject({ "bun.lock": "", "src/x.ts": "" });
		const bun = createFakeBun({ commands: ["check"] });

		const result = await diagnose(root, bun);

		expect(result.content[0]?.text).not.toContain("Lint:");
		expect(commandsRun(bun)).not.toContain("lint -f json .");
	});

	it("#given a bun with lint #when diagnosed #then bun lint diagnostics join the typecheck", async () => {
		const root = createProject({ "bun.lock": "", "src/x.ts": "let a = 1\n" });
		const bun = createFakeBun({ commands: ["check", "lint"], lintStdout: LINT_REPORT(root), lintExitCode: 1 });

		const result = await diagnose(root, bun);
		const details = result.details as LspDiagnosticsDetails;

		expect(result.content[0]?.text).toContain("Lint: bun lint");
		expect(result.content[0]?.text).toContain("error[bun lint] (prefer-const) at 1:0: Use const");
		expect(details.projectCommands).toEqual(["bun check", "bun lint"]);
		expect(commandsRun(bun)).toContain("lint -f json .");
	});

	it("#given a bun lint that cannot lint #when diagnosed #then the typecheck stands and the lint failure is named", async () => {
		const root = createProject({ "bun.lock": "", "src/x.ts": "" });
		const bun = createFakeBun({ commands: ["check", "lint"], lintStdout: "", lintExitCode: 2 });

		const result = await diagnose(root, bun);

		expect(result.content[0]?.text).toContain("Typecheck: bun check");
		expect(result.content[0]?.text).toContain("Lint: bun lint could not lint (exit 2)");
	});
});

describe("fallback to the language server path", () => {
	it("#given a non-Bun project #when the Bun path is consulted #then it declines without running bun", async () => {
		const root = createProject({ "package.json": "{}", "src/x.ts": "" });
		const bun = createFakeBun({ commands: ["check", "lint"] });

		expect(await runBunDirectoryDiagnostics(root, ".ts", "all", undefined, { resolveBun: () => bun.path })).toBeUndefined();
		expect(bun.calls()).toEqual([]);
	});

	it("#given a project script named check #when the Bun path is consulted #then it declines without running bun check", async () => {
		const root = createProject({ "bun.lock": "", "package.json": '{"scripts":{"check":"tsc --noEmit"}}', "src/x.ts": "" });
		const bun = createFakeBun({ commands: ["check"] });

		expect(await runBunDirectoryDiagnostics(root, ".ts", "all", undefined, { resolveBun: () => bun.path })).toBeUndefined();
		expect(bun.calls()).toEqual([]);
	});

	it("#given a bun without check, or a bun check that fails to run #when consulted #then it declines", async () => {
		const root = createProject({ "bun.lock": "", "src/x.ts": "" });
		const old = createFakeBun({ commands: [] });
		const broken = createFakeBun({ commands: ["check"], checkStdout: "error: tsconfig.json not found\n", checkExitCode: 1 });

		expect(await runBunDirectoryDiagnostics(root, ".ts", "all", undefined, { resolveBun: () => old.path })).toBeUndefined();
		expect(await runBunDirectoryDiagnostics(root, ".ts", "all", undefined, { resolveBun: () => broken.path })).toBeUndefined();
	});

	it("#given a JavaScript directory #when consulted #then the Bun typecheck path is not used", async () => {
		const root = createProject({ "bun.lock": "", "src/x.js": "" });
		const bun = createFakeBun({ commands: ["check"] });

		expect(await runBunDirectoryDiagnostics(root, ".js", "all", undefined, { resolveBun: () => bun.path })).toBeUndefined();
		expect(bun.calls()).toEqual([]);
	});
});


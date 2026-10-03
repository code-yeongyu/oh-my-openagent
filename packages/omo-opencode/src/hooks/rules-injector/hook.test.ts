import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import { contextCollector } from "../../features/context-injector";
import { createRulesInjectorHook } from "./hook";

const SESSION_ID = "ses-rules-injector-before-test";

function createFixtureProject(): string {
	const root = mkdtempSync(join(tmpdir(), "rules-injector-hook-"));
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(
		join(root, ".omo", "rules", "db-rules.md"),
		"---\nalwaysApply: true\n---\n# DB Rules\nNEVER MODIFY DATABASE FILES DIRECTLY\n",
	);
	return root;
}

function createHook(root: string) {
	return createRulesInjectorHook(
		{ directory: root, client: {} } as unknown as PluginInput,
		undefined,
		{ skipClaudeUserRules: true },
	);
}

describe("createRulesInjectorHook tool.execute.before", () => {
	test("#given tracked write tool near AGENTS.md #when tool.execute.before fires #then rules registered as pending pre-decision context", async () => {
		// given
		const root = createFixtureProject();
		const hooks = createHook(root);
		try {
			// when
			await hooks["tool.execute.before"](
				{ tool: "write", sessionID: SESSION_ID, callID: "call-1" },
				{ args: { filePath: join(root, "src", "main.ts") } },
			);

			// then
			const pending = contextCollector.getPending(SESSION_ID);
			expect(pending.hasContent).toBe(true);
			expect(pending.merged).toContain(
				"NEVER MODIFY DATABASE FILES DIRECTLY",
			);
			expect(pending.merged).toContain("[Rule: .omo/rules/db-rules.md]");
		} finally {
			contextCollector.clear(SESSION_ID);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("#given rules already registered before execution #when tool.execute.after fires on same path #then output not appended again", async () => {
		// given
		const root = createFixtureProject();
		const hooks = createHook(root);
		const targetPath = join(root, "src", "main.ts");
		try {
			await hooks["tool.execute.before"](
				{ tool: "edit", sessionID: SESSION_ID, callID: "call-1" },
				{ args: { filePath: targetPath } },
			);

			// when
			const output = { title: targetPath, output: "ok", metadata: {} };
			await hooks["tool.execute.after"](
				{ tool: "edit", sessionID: SESSION_ID, callID: "call-1" },
				output,
			);

			// then
			expect(output.output).toBe("ok");
		} finally {
			contextCollector.clear(SESSION_ID);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("#given untracked tool #when tool.execute.before fires #then nothing registered", async () => {
		// given
		const root = createFixtureProject();
		const hooks = createHook(root);
		try {
			// when
			await hooks["tool.execute.before"](
				{ tool: "bash", sessionID: SESSION_ID, callID: "call-1" },
				{ args: { command: "ls" } },
			);

			// then
			expect(contextCollector.hasPending(SESSION_ID)).toBe(false);
		} finally {
			contextCollector.clear(SESSION_ID);
			rmSync(root, { recursive: true, force: true });
		}
	});
});

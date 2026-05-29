import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { resolveUltragoalScope } from "../src/cli-commands.js";
import { makeUltragoalScope } from "../src/session-scope.js";
import { createUltragoalPlan } from "../src/plan-crud.js";
import { UltragoalError } from "../src/types.js";

const BRIEF = "- a goal objective for scope resolution\n";

let savedEnv: string | undefined;

beforeEach(() => {
	savedEnv = process.env["CLAUDE_SESSION_ID"];
	delete process.env["CLAUDE_SESSION_ID"];
});

afterEach(() => {
	if (savedEnv === undefined) delete process.env["CLAUDE_SESSION_ID"];
	else process.env["CLAUDE_SESSION_ID"] = savedEnv;
});

describe("resolveUltragoalScope precedence", () => {
	it("1. --session-id flag wins", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-cli-flag-"));
		process.env["CLAUDE_SESSION_ID"] = "env-session";
		const scope = await resolveUltragoalScope(repoRoot, ["--session-id", "flag-session"]);
		expect(scope.sessionId).toBe("claude:flag-session");
	});

	it("2. $CLAUDE_SESSION_ID is used when no flag", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-cli-env-"));
		process.env["CLAUDE_SESSION_ID"] = "env-session";
		const scope = await resolveUltragoalScope(repoRoot, []);
		expect(scope.sessionId).toBe("claude:env-session");
	});

	it("3. newest-active session in index.json when no flag/env", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-cli-idx-"));
		await createUltragoalPlan(makeUltragoalScope(repoRoot, "first"), { brief: BRIEF });
		await createUltragoalPlan(makeUltragoalScope(repoRoot, "second"), { brief: BRIEF });
		const scope = await resolveUltragoalScope(repoRoot, []);
		// "second" was created last -> newest active.
		expect(scope.sessionId).toBe("claude:second");
	});

	it("4. errors with ULTRAGOAL_SESSION_REQUIRED when nothing resolves", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "ug-cli-none-"));
		let caught: unknown;
		try {
			await resolveUltragoalScope(repoRoot, []);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(UltragoalError);
		expect((caught as UltragoalError).code).toBe("ULTRAGOAL_SESSION_REQUIRED");
	});
});

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "./config";

describe("config check", () => {
	describe("checkConfig", () => {
		it("returns a valid CheckResult", async () => {
			//#given config check is available
			//#when running the consolidated config check
			const result = await config.checkConfig();

			//#then should return a properly shaped CheckResult
			expect(result.name).toBe("Configuration");
			expect(["pass", "fail", "warn", "skip"]).toContain(result.status);
			expect(typeof result.message).toBe("string");
			expect(Array.isArray(result.issues)).toBe(true);
		});

		it("includes issues array even when config is valid", async () => {
			//#given a normal environment
			//#when running config check
			const result = await config.checkConfig();

			//#then issues should be an array (possibly empty)
			expect(Array.isArray(result.issues)).toBe(true);
		});

		it("falls back to legacy config when canonical config is malformed", async () => {
			const originalEnv = process.env.OPENCODE_CONFIG_DIR;
			const originalCwd = process.cwd();
			const tempBase = join(
				tmpdir(),
				`omo-doctor-config-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			const tempProject = join(
				tmpdir(),
				`omo-doctor-config-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);

			try {
				mkdirSync(tempBase, { recursive: true });
				mkdirSync(tempProject, { recursive: true });
				process.env.OPENCODE_CONFIG_DIR = tempBase;
				process.chdir(tempProject);

				writeFileSync(
					join(tempBase, "oh-my-openagent.jsonc"),
					"{ invalid jsonc",
					"utf-8",
				);
				writeFileSync(
					join(tempBase, "oh-my-opencode.jsonc"),
					JSON.stringify(
						{ disabled_hooks: ["legacy-fallback-hook"] },
						null,
						2,
					) + "\n",
					"utf-8",
				);

				const freshConfig = await import(
					`./config?test=${Date.now()}-${Math.random()}`
				);
				const result = await freshConfig.checkConfig();

				expect(result.status).toBe("pass");
				expect(result.details).toContain(
					`Path: ${join(tempBase, "oh-my-opencode.jsonc")}`,
				);
			} finally {
				if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
				else process.env.OPENCODE_CONFIG_DIR = originalEnv;
				process.chdir(originalCwd);
				rmSync(tempBase, { recursive: true, force: true });
				rmSync(tempProject, { recursive: true, force: true });
			}
		});
	});
});

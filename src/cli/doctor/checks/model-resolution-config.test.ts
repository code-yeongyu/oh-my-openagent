import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("model-resolution-config", () => {
	it("merges user config with project override using runtime precedence", async () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const originalCwd = process.cwd();
		const tempBase = join(
			tmpdir(),
			`omo-model-resolution-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const tempProject = join(
			tmpdir(),
			`omo-model-resolution-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		try {
			mkdirSync(tempBase, { recursive: true });
			mkdirSync(join(tempProject, ".opencode"), { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;
			process.chdir(tempProject);

			writeFileSync(
				join(tempBase, "oh-my-openagent.jsonc"),
				JSON.stringify(
					{
						agents: {
							oracle: { model: "openai/gpt-5.4" },
						},
					},
					null,
					2,
				) + "\n",
				"utf-8",
			);
			writeFileSync(
				join(tempProject, ".opencode", "oh-my-openagent.jsonc"),
				JSON.stringify(
					{
						categories: {
							"visual-engineering": { model: "google/gemini-3-flash-preview" },
						},
					},
					null,
					2,
				) + "\n",
				"utf-8",
			);

			const { loadOmoConfig } = await import(
				`./model-resolution-config?test=${Date.now()}-${Math.random()}`
			);
			const result = loadOmoConfig();

			expect(result?.agents?.oracle?.model).toBe("openai/gpt-5.4");
			expect(result?.categories?.["visual-engineering"]?.model).toBe(
				"google/gemini-3-flash-preview",
			);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			process.chdir(originalCwd);
			rmSync(tempBase, { recursive: true, force: true });
			rmSync(tempProject, { recursive: true, force: true });
		}
	});

	it("loads legacy-only config without creating a canonical copy during diagnostics", async () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const originalCwd = process.cwd();
		const tempBase = join(
			tmpdir(),
			`omo-model-resolution-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const tempProject = join(
			tmpdir(),
			`omo-model-resolution-legacy-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		try {
			mkdirSync(tempBase, { recursive: true });
			mkdirSync(tempProject, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;
			process.chdir(tempProject);

			const legacyPath = join(tempBase, "oh-my-opencode.jsonc");
			const canonicalPath = join(tempBase, "oh-my-openagent.jsonc");
			writeFileSync(
				legacyPath,
				JSON.stringify(
					{
						agents: {
							oracle: { model: "anthropic/claude-opus-4-6" },
						},
					},
					null,
					2,
				) + "\n",
				"utf-8",
			);

			const { loadOmoConfig } = await import(
				`./model-resolution-config?test=${Date.now()}-${Math.random()}`
			);
			const result = loadOmoConfig();

			expect(result?.agents?.oracle?.model).toBe("anthropic/claude-opus-4-6");
			expect(existsSync(canonicalPath)).toBe(false);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			process.chdir(originalCwd);
			rmSync(tempBase, { recursive: true, force: true });
			rmSync(tempProject, { recursive: true, force: true });
		}
	});
});

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	getConfigPaths,
	getMergedServers,
	loadJsonFile,
} from "./server-config-loader";

describe("loadJsonFile", () => {
	it("parses JSONC config files with comments correctly", () => {
		// given
		const testData = {
			lsp: {
				typescript: {
					command: ["tsserver"],
					extensions: [".ts", ".tsx"],
				},
			},
		};
		const jsoncContent = `{
  // LSP configuration for TypeScript
  "lsp": {
    "typescript": {
      "command": ["tsserver"],
      "extensions": [".ts", ".tsx"] // TypeScript extensions
    }
  }
}`;
		const tempPath = join(tmpdir(), "test-config.jsonc");
		writeFileSync(tempPath, jsoncContent, "utf-8");

		// when
		const result = loadJsonFile<typeof testData>(tempPath);

		// then
		expect(result).toEqual(testData);

		// cleanup
		unlinkSync(tempPath);
	});

	it("discovers JSONC-only user config (oh-my-opencode.jsonc)", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-user-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			const userJsonc = `{
  // user jsonc config
  "lsp": {
    "user-jsonc": {
      "command": ["user-jsonc-cmd"],
      "extensions": [".ujs"]
    }
  }
}`;
			const userPath = join(tempBase, "oh-my-opencode.jsonc");
			writeFileSync(userPath, userJsonc, "utf-8");

			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "user-jsonc" && s.source === "user",
			);
			expect(found !== undefined).toBe(true);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("discovers JSONC-only opencode config (opencode.jsonc)", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-oc-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			const opencodeJsonc = `{
  // opencode jsonc config
  "lsp": {
    "opencode-jsonc": {
      "command": ["opencode-jsonc-cmd"],
      "extensions": [".ocjs"]
    }
  }
}`;
			const opencodePath = join(tempBase, "opencode.jsonc");
			writeFileSync(opencodePath, opencodeJsonc, "utf-8");

			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "opencode-jsonc" && s.source === "opencode",
			);
			expect(found !== undefined).toBe(true);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("discovers JSONC-only project config (.opencode/oh-my-opencode.jsonc)", () => {
		const originalCwd = process.cwd();
		const tempProject = join(
			tmpdir(),
			`omo-test-project-jsonc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(join(tempProject, ".opencode"), { recursive: true });
			const projectJsonc = `{
  // project jsonc config
  "lsp": {
    "project-jsonc": {
      "command": ["project-jsonc-cmd"],
      "extensions": [".pjs"]
    }
  }
}`;
			const projectPath = join(
				tempProject,
				".opencode",
				"oh-my-opencode.jsonc",
			);
			writeFileSync(projectPath, projectJsonc, "utf-8");

			process.chdir(tempProject);
			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "project-jsonc" && s.source === "project",
			);
			expect(found !== undefined).toBe(true);
		} finally {
			process.chdir(originalCwd);
			rmSync(tempProject, { recursive: true, force: true });
		}
	});

	it("prefers .jsonc over .json when both exist for same config id", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-precedence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			const jsonContent = `{
  "lsp": {
    "conflict": {
      "command": ["from-json"],
      "extensions": [".j"]
    }
  }
}`;
			const jsoncContent = `{
  // jsonc should take precedence
  "lsp": {
    "conflict": {
      "command": ["from-jsonc"],
      "extensions": [".jc"]
    }
  }
}`;
			writeFileSync(
				join(tempBase, "oh-my-opencode.json"),
				jsonContent,
				"utf-8",
			);
			writeFileSync(
				join(tempBase, "oh-my-opencode.jsonc"),
				jsoncContent,
				"utf-8",
			);

			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "conflict" && s.source === "user",
			);
			expect(
				found?.command &&
					Array.isArray(found.command) &&
					found.command[0] === "from-jsonc",
			).toBe(true);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("prefers canonical user config over legacy user config", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-user-canonical-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			writeFileSync(
				join(tempBase, "oh-my-opencode.jsonc"),
				'{\n  "lsp": {\n    "legacy-user": {\n      "command": ["legacy-user-cmd"],\n      "extensions": [".lu"]\n    }\n  }\n}',
				"utf-8",
			);
			writeFileSync(
				join(tempBase, "oh-my-openagent.jsonc"),
				'{\n  "lsp": {\n    "canonical-user": {\n      "command": ["canonical-user-cmd"],\n      "extensions": [".cu"]\n    }\n  }\n}',
				"utf-8",
			);

			const servers = getMergedServers();
			expect(
				servers.find(
					(s) => s.id === "canonical-user" && s.source === "user",
				) !== undefined,
			).toBe(true);
			expect(servers.some((s) => s.id === "legacy-user")).toBe(false);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("falls back to legacy user config when canonical user config is malformed", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-user-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			writeFileSync(
				join(tempBase, "oh-my-openagent.jsonc"),
				"{ invalid jsonc",
				"utf-8",
			);
			writeFileSync(
				join(tempBase, "oh-my-opencode.jsonc"),
				'{\n  "lsp": {\n    "legacy-user-fallback": {\n      "command": ["legacy-user-fallback-cmd"],\n      "extensions": [".luf"]\n    }\n  }\n}',
				"utf-8",
			);

			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "legacy-user-fallback" && s.source === "user",
			);
			expect(found !== undefined).toBe(true);
			expect(found?.command?.[0]).toBe("legacy-user-fallback-cmd");
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("falls back to legacy user config when canonical user config has a non-object root", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const tempBase = join(
			tmpdir(),
			`omo-test-user-nonobject-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			writeFileSync(join(tempBase, "oh-my-openagent.jsonc"), "null", "utf-8");
			writeFileSync(
				join(tempBase, "oh-my-opencode.jsonc"),
				'{\n  "lsp": {\n    "legacy-user-nonobject": {\n      "command": ["legacy-user-nonobject-cmd"],\n      "extensions": [".lun"]\n    }\n  }\n}',
				"utf-8",
			);

			const servers = getMergedServers();
			const found = servers.find(
				(s) => s.id === "legacy-user-nonobject" && s.source === "user",
			);
			expect(found !== undefined).toBe(true);
			expect(found?.command?.[0]).toBe("legacy-user-nonobject-cmd");
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("prefers canonical project config over legacy project config", () => {
		const originalCwd = process.cwd();
		const tempProject = join(
			tmpdir(),
			`omo-test-project-canonical-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(join(tempProject, ".opencode"), { recursive: true });
			writeFileSync(
				join(tempProject, ".opencode", "oh-my-opencode.jsonc"),
				'{\n  "lsp": {\n    "legacy-project": {\n      "command": ["legacy-project-cmd"],\n      "extensions": [".lp"]\n    }\n  }\n}',
				"utf-8",
			);
			writeFileSync(
				join(tempProject, ".opencode", "oh-my-openagent.jsonc"),
				'{\n  "lsp": {\n    "canonical-project": {\n      "command": ["canonical-project-cmd"],\n      "extensions": [".cp"]\n    }\n  }\n}',
				"utf-8",
			);

			process.chdir(tempProject);
			const servers = getMergedServers();
			expect(
				servers.find(
					(s) => s.id === "canonical-project" && s.source === "project",
				) !== undefined,
			).toBe(true);
			expect(servers.some((s) => s.id === "legacy-project")).toBe(false);
		} finally {
			process.chdir(originalCwd);
			rmSync(tempProject, { recursive: true, force: true });
		}
	});

	it("prefers project canonical config over user canonical config", () => {
		const originalEnv = process.env.OPENCODE_CONFIG_DIR;
		const originalCwd = process.cwd();
		const tempBase = join(
			tmpdir(),
			`omo-test-layer-precedence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const tempProject = join(
			tmpdir(),
			`omo-test-layer-project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		try {
			mkdirSync(tempBase, { recursive: true });
			mkdirSync(join(tempProject, ".opencode"), { recursive: true });
			process.env.OPENCODE_CONFIG_DIR = tempBase;

			writeFileSync(
				join(tempBase, "oh-my-openagent.jsonc"),
				'{\n  "lsp": {\n    "shared-precedence": {\n      "command": ["user-cmd"],\n      "extensions": [".sp"]\n    }\n  }\n}',
				"utf-8",
			);
			writeFileSync(
				join(tempProject, ".opencode", "oh-my-openagent.jsonc"),
				'{\n  "lsp": {\n    "shared-precedence": {\n      "command": ["project-cmd"],\n      "extensions": [".sp"]\n    }\n  }\n}',
				"utf-8",
			);

			process.chdir(tempProject);
			const servers = getMergedServers();
			const found = servers.find((s) => s.id === "shared-precedence");
			expect(found?.source).toBe("project");
			expect(
				Array.isArray(found?.command) && found?.command[0] === "project-cmd",
			).toBe(true);
		} finally {
			if (originalEnv === undefined) delete process.env.OPENCODE_CONFIG_DIR;
			else process.env.OPENCODE_CONFIG_DIR = originalEnv;
			process.chdir(originalCwd);
			rmSync(tempBase, { recursive: true, force: true });
			rmSync(tempProject, { recursive: true, force: true });
		}
	});
});

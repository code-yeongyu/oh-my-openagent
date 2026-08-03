import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolvePathInsideContext } from "./client-wrapper.js";
import { LspInvalidPathError } from "./errors.js";

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

describe("LSP client path confinement", () => {
	it("#given a relative file inside context cwd #when resolving workspace #then marker search stays inside cwd", () => {
		const root = tempRoot("lsp-client-wrapper-root-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "file.ts"), "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given an absolute file outside context cwd #when resolving #then rejects before workspace inference", () => {
		const root = tempRoot("lsp-client-wrapper-cwd-");
		const outside = tempRoot("lsp-client-wrapper-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				findWorkspaceRoot(join(outside, "file.ts")),
			),
		).toThrow(LspInvalidPathError);
	});

	it("#given a symlink inside cwd that points outside #when resolving #then rejects the escape", () => {
		const root = tempRoot("lsp-client-wrapper-symlink-root-");
		const outside = tempRoot("lsp-client-wrapper-symlink-outside-");
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				resolvePathInsideContext("linked/file.ts"),
			),
		).toThrow(LspInvalidPathError);
	});
});

describe("findWorkspaceRoot marker priority", () => {
	// given a project root with .git and a nested sub-package that has its own pyproject.toml
	// when resolving workspace root for a file inside the sub-package
	// then .git at the project root takes priority over the nearer pyproject.toml
	it("#given .git at project root and nested pyproject.toml in sub-package #when resolving #then prefers .git over nearer pyproject.toml", () => {
		const root = tempRoot("lsp-ws-priority-git-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "packages", "sub-pkg"), { recursive: true });
		writeFileSync(join(root, "packages", "sub-pkg", "pyproject.toml"), "[project]\nname = 'sub-pkg'\n");
		writeFileSync(join(root, "packages", "sub-pkg", "main.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("packages/sub-pkg/main.py"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a sub-package with pyproject.toml but NO .git anywhere up the tree
	// when resolving workspace root for a file inside the sub-package
	// then falls back to the first non-.git marker (pyproject.toml directory)
	it("#given nested pyproject.toml and no .git anywhere #when resolving #then falls back to first non-git marker", () => {
		const root = tempRoot("lsp-ws-priority-fallback-");
		mkdirSync(join(root, "packages", "sub-pkg"), { recursive: true });
		writeFileSync(join(root, "packages", "sub-pkg", "pyproject.toml"), "[project]\nname = 'sub-pkg'\n");
		writeFileSync(join(root, "packages", "sub-pkg", "main.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("packages/sub-pkg/main.py"),
		);

		expect(workspace).toBe(realpathSync(join(root, "packages", "sub-pkg")));
	});

	// given a directory with both .git and pyproject.toml at the same level
	// when resolving workspace root
	// then returns that directory (both markers agree)
	it("#given .git and pyproject.toml at same level #when resolving #then returns that directory", () => {
		const root = tempRoot("lsp-ws-priority-same-level-");
		mkdirSync(join(root, ".git"), { recursive: true });
		writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'my-project'\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "main.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/main.py"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given .git is a file (git worktree/submodule pointer) rather than a directory
	// when resolving workspace root
	// then existsSync returns true for the file and the directory is returned as root
	it("#given .git is a file (git worktree pointer) rather than a directory #when resolving #then treats it as a valid workspace root", () => {
		const root = tempRoot("lsp-ws-priority-worktree-");
		// git worktree creates .git as a file: "gitdir: /path/to/main/.git/worktrees/name"
		writeFileSync(join(root, ".git"), "gitdir: /some/path/.git/worktrees/feature\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "main.ts"), "export const x = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/main.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a JS/TS monorepo with .git at root and nested package.json in a sub-package
	// when resolving workspace root for a file inside the sub-package
	// then .git at the project root takes priority over the nearer package.json
	it("#given .git at root and nested package.json in JS/TS monorepo #when resolving #then prefers .git over nearer package.json", () => {
		const root = tempRoot("lsp-ws-priority-js-monorepo-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "packages", "ui-lib"), { recursive: true });
		writeFileSync(join(root, "packages", "ui-lib", "package.json"), `{"name": "ui-lib", "version": "1.0.0"}\n`);
		writeFileSync(join(root, "packages", "ui-lib", "index.ts"), "export const x = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("packages/ui-lib/index.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a Rust workspace with .git at root and nested Cargo.toml in a crate
	// when resolving workspace root for a file inside the crate
	// then .git at the project root takes priority over the nearer Cargo.toml
	it("#given .git at root and nested Cargo.toml in Rust workspace #when resolving #then prefers .git over nearer Cargo.toml", () => {
		const root = tempRoot("lsp-ws-priority-rust-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "crates", "core-lib"), { recursive: true });
		writeFileSync(join(root, "crates", "core-lib", "Cargo.toml"), "[package]\nname = 'core-lib'\nversion = '0.1.0'\n");
		mkdirSync(join(root, "crates", "core-lib", "src"), { recursive: true });
		writeFileSync(join(root, "crates", "core-lib", "src", "lib.rs"), "pub fn add(a: i32, b: i32) -> i32 { a + b }\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("crates/core-lib/src/lib.rs"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a Go module workspace with .git at root and nested go.mod in a sub-module
	// when resolving workspace root for a file inside the sub-module
	// then .git at the project root takes priority over the nearer go.mod
	it("#given .git at root and nested go.mod in Go multi-module repo #when resolving #then prefers .git over nearer go.mod", () => {
		const root = tempRoot("lsp-ws-priority-go-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "services", "api"), { recursive: true });
		writeFileSync(join(root, "services", "api", "go.mod"), "module github.com/example/api\n\ngo 1.22\n");
		writeFileSync(join(root, "services", "api", "main.go"), "package main\n\nfunc main() {}\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("services/api/main.go"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a Java Maven multi-module project with .git at root and nested pom.xml in a module
	// when resolving workspace root for a file inside the module
	// then .git at the project root takes priority over the nearer pom.xml
	it("#given .git at root and nested pom.xml in Maven multi-module #when resolving #then prefers .git over nearer pom.xml", () => {
		const root = tempRoot("lsp-ws-priority-maven-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "modules", "core"), { recursive: true });
		writeFileSync(join(root, "modules", "core", "pom.xml"), "<project>\n  <artifactId>core</artifactId>\n</project>\n");
		mkdirSync(join(root, "modules", "core", "src"), { recursive: true });
		writeFileSync(join(root, "modules", "core", "src", "Main.java"), "public class Main {}\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("modules/core/src/Main.java"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a Gradle multi-module project with .git at root and nested build.gradle in a module
	// when resolving workspace root for a file inside the module
	// then .git at the project root takes priority over the nearer build.gradle
	it("#given .git at root and nested build.gradle in Gradle multi-module #when resolving #then prefers .git over nearer build.gradle", () => {
		const root = tempRoot("lsp-ws-priority-gradle-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "subprojects", "app"), { recursive: true });
		writeFileSync(join(root, "subprojects", "app", "build.gradle"), "plugins { id 'java' }\n");
		mkdirSync(join(root, "subprojects", "app", "src"), { recursive: true });
		writeFileSync(join(root, "subprojects", "app", "src", "App.java"), "public class App {}\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("subprojects/app/src/App.java"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	// given a git submodule with its own .git file pointer inside a parent repo
	// when resolving workspace root for a file inside the submodule
	// then the submodule's .git file pointer is found and the submodule root is returned
	// (not the parent repo root — submodules are independent workspaces)
	it("#given .git as a file in a submodule directory #when resolving #then returns the submodule root not the parent", () => {
		const root = tempRoot("lsp-ws-priority-submodule-");
		// parent repo has .git directory
		mkdirSync(join(root, ".git"), { recursive: true });
		// submodule has .git as a file (gitdir pointer)
		mkdirSync(join(root, "vendor", "submodule", "src"), { recursive: true });
		writeFileSync(join(root, "vendor", "submodule", ".git"), "gitdir: ../../.git/modules/vendor/submodule\n");
		writeFileSync(join(root, "vendor", "submodule", "src", "lib.rs"), "pub fn init() {}\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("vendor/submodule/src/lib.rs"),
		);

		// should stop at the submodule root (where .git file is), not walk up to parent .git
		expect(workspace).toBe(realpathSync(join(root, "vendor", "submodule")));
	});

	// given multiple nested fallback markers with no .git
	// when resolving workspace root
	// then returns the first (nearest) fallback marker found, not the outermost
	it("#given multiple nested fallback markers and no .git #when resolving #then returns nearest fallback marker", () => {
		const root = tempRoot("lsp-ws-priority-multi-fallback-");
		// outer dir has package.json, inner dir has pyproject.toml — neither has .git
		writeFileSync(join(root, "package.json"), `{"name": "outer"}\n`);
		mkdirSync(join(root, "inner"), { recursive: true });
		writeFileSync(join(root, "inner", "pyproject.toml"), "[project]\nname = 'inner'\n");
		writeFileSync(join(root, "inner", "main.py"), "x = 1\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("inner/main.py"),
		);

		// nearest fallback marker wins (inner/pyproject.toml)
		expect(workspace).toBe(realpathSync(join(root, "inner")));
	});
});

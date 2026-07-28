import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeCodegraphProject } from "../src/session-start-project.ts";

describe("CodeGraph SessionStart project probe", () => {
	it("#given the exact project directory has a CodeGraph database #when probing #then it is initialized", () => {
		// given
		const projectRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-probe-exact-"));
		try {
			mkdirSync(join(projectRoot, ".codegraph"), { recursive: true });
			writeFileSync(join(projectRoot, ".codegraph", "codegraph.db"), "fixture");

			// when
			const result = probeCodegraphProject(projectRoot);

			// then
			expect(result).toEqual({ kind: "initialized" });
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});

	it("#given an ancestor directory has a CodeGraph database #when probing a nested project #then the ancestor covers it", () => {
		// given
		const ancestorRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-probe-ancestor-"));
		const projectRoot = join(ancestorRoot, "apps", "server");
		try {
			mkdirSync(join(ancestorRoot, ".codegraph"), { recursive: true });
			mkdirSync(projectRoot, { recursive: true });
			writeFileSync(join(ancestorRoot, ".codegraph", "codegraph.db"), "fixture");

			// when
			const result = probeCodegraphProject(projectRoot);

			// then
			expect(result).toEqual({ ancestorRoot: realpathSync(ancestorRoot), kind: "nested-root" });
		} finally {
			rmSync(ancestorRoot, { recursive: true, force: true });
		}
	});

	it("#given neither the project nor its ancestors have a CodeGraph database #when probing #then it is definitively uninitialized", () => {
		// given
		const projectRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-probe-missing-"));
		try {
			// when
			const result = probeCodegraphProject(projectRoot);

			// then
			expect(result).toEqual({ kind: "uninitialized" });
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

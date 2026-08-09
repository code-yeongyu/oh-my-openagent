import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { sharedSkillsRootPath } from "./index.mjs";

const packageRoot = import.meta.dir;
const moduleUnderTest = join(packageRoot, "index.mjs");
const cleanupRoots: string[] = [];

type RootPathModule = { sharedSkillsRootPath: () => string };

/**
 * Copies the real index.mjs into a throwaway layout and imports it from there, so
 * `import.meta.url` inside the module resolves against the fixture instead of the
 * source tree. That is exactly how the bundlers inline it into dist/index.js (depth 0)
 * versus dist/cli/index.js and dist/cli-node/index.js (depth 1).
 */
async function loadFrom(moduleDirectory: string): Promise<RootPathModule> {
	mkdirSync(moduleDirectory, { recursive: true });
	const copiedModule = join(moduleDirectory, "index.mjs");
	copyFileSync(moduleUnderTest, copiedModule);
	return (await import(pathToFileURL(copiedModule).href)) as RootPathModule;
}

/**
 * realpathSync matters here: on macOS the temp dir lives under a symlinked /var, and the
 * dynamic import canonicalizes the module URL, so the resolved root would otherwise be
 * compared against a non-canonical expectation.
 */
function createFixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "shared-skills-root-"));
	cleanupRoots.push(root);
	return realpathSync(root);
}

describe("sharedSkillsRootPath", () => {
	test("#given the module beside its own skills directory #when the root is resolved #then the sibling directory wins", () => {
		// given
		const expectedSuffix = join("shared-skills", "skills") + sep;

		// when
		const resolved = sharedSkillsRootPath();

		// then
		expect(resolved.endsWith(expectedSuffix)).toBe(true);
		expect(existsSync(resolved)).toBe(true);
	});

	test("#given a bundle one level below the skills directory #when the root is resolved #then the parent directory is used", async () => {
		// given
		const root = createFixtureRoot();
		mkdirSync(join(root, "skills", "ast-grep"), { recursive: true });
		const bundleDirectory = join(root, "cli");

		// when
		const loaded = await loadFrom(bundleDirectory);
		const resolved = loaded.sharedSkillsRootPath();

		// then
		expect(resolve(resolved)).toBe(resolve(join(root, "skills")));
		expect(existsSync(resolved)).toBe(true);
	});

	test("#given the Codex marketplace layout #when the root is resolved #then the skills directory two levels up is used", async () => {
		// given: `plugin/` is copied to `plugins/omo/` (so skills land at `plugins/omo/skills`)
		// while the root CLI runtimes are bundled to `plugins/omo/dist/cli` and
		// `plugins/omo/dist/cli-node`, two levels below the skills directory (AGENTS.md).
		const root = createFixtureRoot();
		mkdirSync(join(root, "skills", "ast-grep"), { recursive: true });
		const bundleDirectory = join(root, "dist", "cli");

		// when
		const loaded = await loadFrom(bundleDirectory);
		const resolved = loaded.sharedSkillsRootPath();

		// then
		expect(resolve(resolved)).toBe(resolve(join(root, "skills")));
		expect(existsSync(resolved)).toBe(true);
	});

	test("#given a nearer skills directory than the marketplace one #when the root is resolved #then the nearest wins", async () => {
		// given: both `dist/skills` and `skills` exist, so probe precedence has to be observable
		const root = createFixtureRoot();
		mkdirSync(join(root, "skills", "ast-grep"), { recursive: true });
		mkdirSync(join(root, "dist", "skills", "ast-grep"), { recursive: true });
		const bundleDirectory = join(root, "dist", "cli");

		// when
		const loaded = await loadFrom(bundleDirectory);
		const resolved = loaded.sharedSkillsRootPath();

		// then
		expect(resolve(resolved)).toBe(resolve(join(root, "dist", "skills")));
	});

	test("#given no skills directory beside or above the module #when the root is resolved #then the sibling path is still returned", async () => {
		// given
		const root = createFixtureRoot();
		const bundleDirectory = join(root, "lonely");

		// when
		const loaded = await loadFrom(bundleDirectory);
		const resolved = loaded.sharedSkillsRootPath();

		// then
		expect(resolve(resolved)).toBe(resolve(join(bundleDirectory, "skills")));
		expect(existsSync(resolved)).toBe(false);
	});
});

afterAll(() => {
	for (const root of cleanupRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

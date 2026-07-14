import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const tempDirectories: string[] = [];
const WORKSPACE_MARKERS = new Set([".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"]);
const originalExistsSync = fs.existsSync.bind(fs);

afterEach(() => {
	mock.restore();
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("findWorkspaceRoot", () => {
	test("#given a markerless directory path #when finding workspace root #then the directory itself is the fallback root", async () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "omo-lsp-markerless-root-"));
		tempDirectories.push(root);
		const workspace = join(root, "workspace");
		mkdirSync(workspace, { recursive: true });

		// when / then
		expect(await findWorkspaceRootWithNoMarkers(workspace)).toBe(workspace);
	});

	test("#given a markerless file path #when finding workspace root #then the containing directory stays the fallback root", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-lsp-markerless-file-"));
		tempDirectories.push(workspace);
		const filePath = join(workspace, "app.ts");
		writeFileSync(filePath, "export const value = 1;\n");

		// when / then
		expect(await findWorkspaceRootWithNoMarkers(filePath)).toBe(workspace);
	});
});

async function findWorkspaceRootWithNoMarkers(filePath: string): Promise<string> {
	mock.module("node:fs", () => ({
		...fs,
		existsSync: (path: fs.PathLike): boolean => {
			if (typeof path === "string" && WORKSPACE_MARKERS.has(basename(path))) return false;
			return originalExistsSync(path);
		},
	}));

	const module = await import(`./client-wrapper.js?markerless=${Date.now()}-${Math.random()}`);
	return module.findWorkspaceRoot(filePath);
}

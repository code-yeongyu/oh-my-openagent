import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { parseLspRequestContext, runWithRequestContext } from "../request-context.js";
import { executeLspFormat } from "./format.js";
import type { LspFormatDetails } from "./types.js";

const workspaces: string[] = [];

afterEach(() => {
	for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspaceWith(fileName: string, content: string): { readonly root: string; readonly filePath: string } {
	const root = mkdtempSync(join(tmpdir(), "lsp-format-tool-"));
	workspaces.push(root);
	const filePath = join(root, fileName);
	writeFileSync(filePath, content, "utf-8");
	return { root, filePath };
}

function contextFor(root: string) {
	return parseLspRequestContext({
		cwd: root,
		projectConfigPaths: [join(root, "lsp.json")],
		userConfigPath: join(root, "user-lsp.json"),
		installDecisionsPath: join(root, "install-decisions.json"),
		capabilities: { installDecisionTool: false },
	});
}

describe("executeLspFormat", () => {
	it("#given an extension with no configured server #when format runs #then the missing dependency result is returned and the file is untouched", async () => {
		// given
		const original = "value\n";
		const { root, filePath } = workspaceWith("module.wat", original);

		// when
		const result = await runWithRequestContext(contextFor(root), () => executeLspFormat({ filePath }));

		// then
		const details = result.details as LspFormatDetails;
		expect(details.errorKind).toBe("missing_dependency");
		expect(details.status).toBe("unavailable");
		expect(result.content[0]?.text).toContain("No LSP server configured for extension: .wat");
		expect(readFileSync(filePath)).toEqual(Buffer.from(original));
	});

	it("#given a missing filePath argument #when format runs #then the parameter contract is enforced", async () => {
		// given / when / then
		await expect(executeLspFormat({})).rejects.toThrow(/filePath/);
	});
});

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import type { LspClient } from "./client.js";
import { formatDocumentWithClient } from "./format-document.js";
import type { TextEdit } from "./types.js";

const workspaces: string[] = [];

afterEach(() => {
	for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspaceWith(fileName: string, content: string): { readonly root: string; readonly filePath: string } {
	const root = mkdtempSync(join(tmpdir(), "lsp-format-"));
	workspaces.push(root);
	const filePath = join(root, fileName);
	writeFileSync(filePath, content, "utf-8");
	return { root, filePath };
}

function stubClient(edits: TextEdit[] | null): LspClient {
	return {
		async formatDocument() {
			return edits;
		},
		async openFile() {},
	} as Pick<LspClient, "formatDocument" | "openFile"> as LspClient;
}

describe("formatDocumentWithClient", () => {
	it("#given a server returning text edits #when the document is formatted #then the file is rewritten and line deltas are reported", async () => {
		// given
		const { filePath } = workspaceWith("sample.ts", "const a=1\nconst b   =2\nconst c=3\n");
		const edits: TextEdit[] = [
			{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 12 } }, newText: "const a = 1;\nconst b = 2;" },
		];

		// when
		const result = await formatDocumentWithClient(stubClient(edits), filePath);

		// then
		expect(result.status).toBe("formatted");
		expect(readFileSync(filePath, "utf-8")).toBe("const a = 1;\nconst b = 2;\nconst c=3\n");
		expect(result).toMatchObject({ status: "formatted", linesAdded: 2, linesRemoved: 2 });
	});

	it("#given a server returning an edit that adds lines #when the document is formatted #then the added and removed line counts differ", async () => {
		// given
		const { filePath } = workspaceWith("sample.ts", "const a=1;const b=2\n");
		const edits: TextEdit[] = [
			{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 19 } }, newText: "const a = 1;\nconst b = 2;" },
		];

		// when
		const result = await formatDocumentWithClient(stubClient(edits), filePath);

		// then
		expect(result).toMatchObject({ status: "formatted", linesAdded: 2, linesRemoved: 1 });
		expect(readFileSync(filePath, "utf-8")).toBe("const a = 1;\nconst b = 2;\n");
	});

	it("#given a server that does not advertise document formatting #when the document is formatted #then the result is unavailable and the file bytes are untouched", async () => {
		// given
		const original = "const a=1\n";
		const { filePath } = workspaceWith("sample.ts", original);
		const before = statSync(filePath);

		// when
		const result = await formatDocumentWithClient(stubClient(null), filePath);

		// then
		expect(result).toEqual({ status: "unavailable", reason: "capability_not_advertised" });
		expect(readFileSync(filePath)).toEqual(Buffer.from(original));
		expect(statSync(filePath).mtimeMs).toBe(before.mtimeMs);
	});

	it("#given a server returning no edits #when the document is formatted #then the result is unchanged and the file bytes are untouched", async () => {
		// given
		const original = "const a = 1;\n";
		const { filePath } = workspaceWith("sample.ts", original);

		// when
		const result = await formatDocumentWithClient(stubClient([]), filePath);

		// then
		expect(result).toEqual({ status: "unchanged", linesAdded: 0, linesRemoved: 0 });
		expect(readFileSync(filePath)).toEqual(Buffer.from(original));
	});

	it("#given edits that reproduce the current bytes #when the document is formatted #then the result is unchanged", async () => {
		// given
		const original = "const a = 1;\n";
		const { filePath } = workspaceWith("sample.ts", original);
		const edits: TextEdit[] = [
			{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } }, newText: "const a = 1;" },
		];

		// when
		const result = await formatDocumentWithClient(stubClient(edits), filePath);

		// then
		expect(result.status).toBe("unchanged");
		expect(readFileSync(filePath, "utf-8")).toBe(original);
	});

	it("#given the file shrinks after the server computed its edits #when the edits are applied #then the stale edit is rejected instead of corrupting the file", async () => {
		// given
		const { filePath } = workspaceWith("sample.ts", "const a=1\nconst b=2\n");
		const staleEdits: TextEdit[] = [
			{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 9 } }, newText: "const b = 2;" },
		];
		const racingClient = {
			async formatDocument() {
				writeFileSync(filePath, "short\n", "utf-8");
				return staleEdits;
			},
			async openFile() {},
		} as Pick<LspClient, "formatDocument" | "openFile"> as LspClient;

		// when / then
		await expect(formatDocumentWithClient(racingClient, filePath)).rejects.toThrow(/outside line/);
		expect(readFileSync(filePath, "utf-8")).toBe("short\n");
	});

	it("#given a formatted document #when the write completes #then no temporary file is left behind", async () => {
		// given
		const { root, filePath } = workspaceWith("sample.ts", "const a=1\n");
		const edits: TextEdit[] = [
			{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } }, newText: "const a = 1;" },
		];

		// when
		await formatDocumentWithClient(stubClient(edits), filePath);

		// then
		expect(readFileSync(filePath, "utf-8")).toBe("const a = 1;\n");
		expect(() => statSync(join(root, "sample.ts.tmp"))).toThrow();
	});
});

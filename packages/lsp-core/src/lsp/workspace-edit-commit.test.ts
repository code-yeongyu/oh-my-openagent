import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "bun:test";

import { applyWorkspaceEditDetailed, commitWorkspaceEditPlan, planWorkspaceEdit } from "./workspace-edit.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("workspace edit commit barrier", () => {
	it("#given cancellation before commit #when a valid plan is applied #then no mutation begins", () => {
		const fixture = makeFixture();
		const controller = new AbortController();
		controller.abort();

		const commit = applyWorkspaceEditDetailed(textEdit(fixture.source, "before", "after"), {
			workspaceRoot: fixture.workspace,
			signal: controller.signal,
		});

		expect(commit.result.success).toBe(false);
		expect(commit.result.errors.join("\n")).toContain("cancelled before commit");
		expect(commit.delta.operations).toEqual([]);
		expect(readFileSync(fixture.source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given repeated pre-gate interruptions #when retried #then every attempt leaves the snapshot untouched", () => {
		const fixture = makeFixture();
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const controller = new AbortController();
			controller.abort();
			const commit = applyWorkspaceEditDetailed(textEdit(fixture.source, "before", "after"), {
				workspaceRoot: fixture.workspace,
				signal: controller.signal,
			});
			expect(commit.result.success).toBe(false);
			expect(commit.delta.operations).toEqual([]);
		}
		expect(readFileSync(fixture.source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given cancellation after the first write #when commit has crossed the barrier #then all operations finish once", () => {
		const fixture = makeFixture();
		const second = join(fixture.workspace, "second.ts");
		writeFileSync(second, "const second = 2;\n", "utf-8");
		const controller = new AbortController();
		let writes = 0;

		const commit = applyWorkspaceEditDetailed(
			{
				changes: {
					[pathToFileURL(fixture.source).href]: [replacement("before", "after")],
					[pathToFileURL(second).href]: [replacement("second", "later_")],
				},
			},
			{
				workspaceRoot: fixture.workspace,
				signal: controller.signal,
				io: {
					writeFile(path, content) {
						writes += 1;
						writeFileSync(path, content, "utf-8");
						if (writes === 1) controller.abort();
					},
				},
			},
		);

		expect(commit.result).toMatchObject({ success: true, lateAbort: true, totalEdits: 2 });
		expect(writes).toBe(2);
		expect(readFileSync(fixture.source, "utf-8")).toBe("const after = 1;\n");
		expect(readFileSync(second, "utf-8")).toBe("const later_ = 2;\n");
	});

	it("#given an injected write failure #when commit begins #then the result reports real I/O failure", () => {
		const fixture = makeFixture();

		const commit = applyWorkspaceEditDetailed(textEdit(fixture.source, "before", "after"), {
			workspaceRoot: fixture.workspace,
			io: {
				writeFile() {
					throw new InjectedWriteError();
				},
			},
		});

		expect(commit.result).toMatchObject({ success: false, failedChange: 0 });
		expect(commit.result.errors.join("\n")).toContain("I/O failure during text: injected write failure");
		expect(commit.delta.operations).toEqual([]);
		expect(readFileSync(fixture.source, "utf-8")).toBe("const before = 1;\n");
	});

	it("#given a stale file snapshot #when a prepared plan commits #then the newer bytes are preserved", () => {
		const fixture = makeFixture();
		const planned = planWorkspaceEdit(textEdit(fixture.source, "before", "after"), fixture.workspace);
		expect(planned.success).toBe(true);
		if (!planned.success) return;
		writeFileSync(fixture.source, "const external = 2;\n", "utf-8");

		const commit = commitWorkspaceEditPlan(planned.plan);

		expect(commit.result.success).toBe(false);
		expect(commit.result.errors.join("\n")).toContain("workspace state changed before commit");
		expect(commit.delta.operations).toEqual([]);
		expect(readFileSync(fixture.source, "utf-8")).toBe("const external = 2;\n");
	});
});

class InjectedWriteError extends Error {
	override readonly name = "InjectedWriteError";

	constructor() {
		super("injected write failure");
	}
}

function makeFixture(): { readonly workspace: string; readonly source: string } {
	const workspace = mkdtempSync(join(tmpdir(), "lsp-workspace-commit-"));
	tempDirectories.push(workspace);
	const source = join(workspace, "source.ts");
	writeFileSync(source, "const before = 1;\n", "utf-8");
	return { workspace, source };
}

function textEdit(path: string, before: string, after: string) {
	return { changes: { [pathToFileURL(path).href]: [replacement(before, after)] } };
}

function replacement(before: string, after: string) {
	return {
		range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 + before.length } },
		newText: after,
	};
}

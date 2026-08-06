import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LspClient } from "./client.js";
import { LspClientConnection } from "./connection.js";
import type { LspClientOptions } from "./client.js";
import type { LspClientTransport } from "./transport.js";
import type { Diagnostic, ResolvedServer, WorkspaceEdit } from "./types.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "workspace-edit-server.mjs");

export interface RecordedEvent {
	readonly type: string;
	readonly id?: string | number;
	readonly method?: string;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

export interface WorkspaceEditTestContext {
	readonly client: LspClient;
	readonly workspace: string;
	readonly source: string;
	readonly destination: string;
	readonly closed: string;
	readonly created: string;
	readonly events: string;
}

export function createWorkspaceEditTestHarness() {
	const tempDirectories: string[] = [];
	const clients: LspClientTransport[] = [];

	return {
		async cleanup(): Promise<void> {
			for (const client of clients.splice(0)) await client.stop();
			for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
		},
		async makeClient(
			scenario: Record<string, unknown>,
			clientOptions: Partial<LspClientOptions> = {},
		): Promise<WorkspaceEditTestContext> {
			const fixture = createFixture(scenario, tempDirectories);
			const client = new LspClient(fixture.workspace, fixture.server, {
				requestTimeoutMs: 5_000,
				initializeTimeoutMs: 5_000,
				...clientOptions,
			});
			clients.push(client);
			await client.start();
			await client.initialize();
			return { client, ...fixture.paths };
		},
		async makeBareConnection(
			scenario: Record<string, unknown>,
		): Promise<{ readonly connection: LspClientConnection; readonly events: string }> {
			const fixture = createFixture(scenario, tempDirectories);
			const connection = new LspClientConnection(fixture.workspace, fixture.server, {
				requestTimeoutMs: 5_000,
				initializeTimeoutMs: 5_000,
			});
			clients.push(connection);
			await connection.start();
			await connection.initialize();
			return { connection, events: fixture.paths.events };
		},
	};
}

function createFixture(scenario: Record<string, unknown>, tempDirectories: string[]) {
	const workspace = mkdtempSync(join(tmpdir(), "lsp-apply-edit-"));
	tempDirectories.push(workspace);
	const source = join(workspace, "source.ts");
	const destination = join(workspace, "destination.ts");
	const closed = join(workspace, "closed.ts");
	const created = join(workspace, "created.ts");
	const scenarioPath = join(workspace, "scenario.json");
	const events = join(workspace, "events.jsonl");
	writeFileSync(source, "const before = 1;\n", "utf-8");
	writeFileSync(closed, "const closed = 1;\n", "utf-8");
	const uriByPlaceholder = new Map([
		["file:///placeholder", pathToFileURL(source).href],
		["file:///destination", pathToFileURL(destination).href],
		["file:///closed", pathToFileURL(closed).href],
		["file:///created", pathToFileURL(created).href],
	]);
	writeFileSync(scenarioPath, JSON.stringify(replacePlaceholderUris(scenario, uriByPlaceholder)), "utf-8");
	writeFileSync(events, "", "utf-8");
	const server: ResolvedServer = {
		id: "workspace-edit-fixture",
		command: [process.env["NODE_BINARY"] ?? "node", fixturePath, scenarioPath, events],
		extensions: [".ts"],
		priority: 0,
	};
	return { workspace, server, paths: { workspace, source, destination, closed, created, events } };
}

function replacePlaceholderUris(value: unknown, uriByPlaceholder: ReadonlyMap<string, string>): unknown {
	if (Array.isArray(value)) return value.map((item) => replacePlaceholderUris(item, uriByPlaceholder));
	if (typeof value !== "object" || value === null) {
		return typeof value === "string" ? (uriByPlaceholder.get(value) ?? value) : value;
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, replacePlaceholderUris(item, uriByPlaceholder)]),
	);
}

interface RenameTextEditTarget {
	readonly version: number | null;
	readonly uri?: string;
}

export function renameTextEdit(before: string, after: string, target: RenameTextEditTarget): WorkspaceEdit {
	const uri = target.uri ?? "file:///placeholder";
	return {
		documentChanges: [
			{
				textDocument: { uri, version: target.version },
				edits: [
					{
						range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 + before.length } },
						newText: after,
					},
				],
			},
		],
	};
}

export function diagnostic(message: string): Diagnostic {
	return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message };
}

export function readEvents(path: string): readonly RecordedEvent[] {
	const events: RecordedEvent[] = [];
	for (const line of readFileSync(path, "utf-8").split("\n")) {
		if (!line) continue;
		const value: unknown = JSON.parse(line);
		if (isRecordedEvent(value)) events.push(value);
	}
	return events;
}

export async function waitForEventCount(
	path: string,
	predicate: (event: RecordedEvent) => boolean,
	count: number,
): Promise<readonly RecordedEvent[]> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const matches = readEvents(path).filter(predicate);
		if (matches.length >= count) return matches;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return readEvents(path).filter(predicate);
}

function isRecordedEvent(value: unknown): value is RecordedEvent {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

import {
	collectPostEditDiagnostics,
	createPostEditNotConfiguredCache,
	resetPostEditNotConfiguredCache,
	type PostEditDiagnosticsOutcome,
	type PostEditNotConfiguredCache,
} from "@oh-my-opencode/lsp-core/post-edit";

export type DiagnosticsRunner = (filePath: string) => Promise<PostEditDiagnosticsOutcome>;

const MUTATION_TOOL_NAMES = new Set(["write", "edit", "apply_patch"]);
const POST_EDIT_DIAGNOSTICS_CONCURRENCY = 4;
export const POST_EDIT_DIAGNOSTICS_WIDGET_KEY = "omo-senpi-lsp";

type WidgetPlacement = "aboveEditor" | "belowEditor";
type WidgetSetter = (
	key: string,
	content: readonly string[] | undefined,
	options?: { placement?: WidgetPlacement },
) => void;

export interface ToolResultLike {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly content: readonly { readonly type: string; readonly text?: string }[];
	readonly isError: boolean;
}

export interface PostEditDiagnosticsResult {
	content?: ToolResultLike["content"];
	widgetLines: readonly string[] | undefined;
}

interface DiagnosticBlock {
	filePath: string;
	diagnostics: string;
}

export interface LspPostEditSessionState {
	getOrCreate(sessionId: string | undefined): PostEditNotConfiguredCache;
	onSessionStart(sessionId: string | undefined): void;
	reset(sessionId: string | undefined): void;
	delete(sessionId: string | undefined): void;
}

export function createLspPostEditSessionState(): LspPostEditSessionState {
	const caches = new Map<string, PostEditNotConfiguredCache>();
	return {
		getOrCreate(sessionId: string | undefined): PostEditNotConfiguredCache {
			if (sessionId === undefined) return createPostEditNotConfiguredCache();
			let cache = caches.get(sessionId);
			if (cache === undefined) {
				cache = createPostEditNotConfiguredCache();
				caches.set(sessionId, cache);
			}
			return cache;
		},
		onSessionStart(sessionId: string | undefined): void {
			if (sessionId !== undefined && !caches.has(sessionId)) {
				caches.set(sessionId, createPostEditNotConfiguredCache());
			}
		},
		reset(sessionId: string | undefined): void {
			if (sessionId === undefined) return;
			resetPostEditNotConfiguredCache(this.getOrCreate(sessionId));
		},
		delete(sessionId: string | undefined): void {
			if (sessionId === undefined) return;
			caches.delete(sessionId);
		},
	};
}

export function shouldRunPostEditDiagnostics(event: ToolResultLike): boolean {
	return !event.isError && MUTATION_TOOL_NAMES.has(event.toolName);
}

export async function appendPostEditDiagnostics(
	event: ToolResultLike,
	runDiagnostics: DiagnosticsRunner,
	cache?: PostEditNotConfiguredCache,
): Promise<PostEditDiagnosticsResult | undefined> {
	if (!shouldRunPostEditDiagnostics(event)) return undefined;

	const filePaths = extractMutatedFilePaths(event);
	if (filePaths.length === 0) return undefined;

	const result = await collectPostEditDiagnostics({
		filePaths,
		runDiagnostics,
		cache,
		maxConcurrency: POST_EDIT_DIAGNOSTICS_CONCURRENCY,
	});
	const blocks: readonly DiagnosticBlock[] = result.blocks;

	if (blocks.length === 0) {
		return { widgetLines: undefined };
	}

	return {
		content: [
			...event.content,
			...blocks.map(({ filePath, diagnostics }) => ({
				type: "text" as const,
				text: `\n\nLSP errors detected in ${filePath}, please fix:\n${diagnostics}`,
			})),
		],
		widgetLines: undefined,
	};
}

export function syncPostEditDiagnosticsWidget(
	setWidget: WidgetSetter,
	result: PostEditDiagnosticsResult | undefined,
): void {
	if (!result) return;
	setWidget(POST_EDIT_DIAGNOSTICS_WIDGET_KEY, result.widgetLines, { placement: "belowEditor" });
}

export function extractMutatedFilePaths(event: ToolResultLike): string[] {
	const paths = new Set<string>();
	addStringValue(paths, event.input["path"]);
	addStringValue(paths, event.input["filePath"]);
	addStringArray(paths, event.input["paths"]);
	addStringArray(paths, event.input["filePaths"]);
	addPatchInput(paths, event.input["input"]);
	addPatchFiles(paths, event.input["files"]);
	addPatchFiles(paths, event.input["changes"]);
	return [...paths];
}

function addStringValue(paths: Set<string>, value: unknown): void {
	if (typeof value === "string" && value.length > 0) {
		paths.add(value);
	}
}

function addStringArray(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		addStringValue(paths, item);
	}
}

function addPatchInput(paths: Set<string>, value: unknown): void {
	if (typeof value !== "string") return;
	for (const line of value.split("\n")) {
		const path = extractPatchHeaderPath(line);
		if (path !== undefined) paths.add(path);
	}
}

function extractPatchHeaderPath(line: string): string | undefined {
	const prefixes = ["*** Add File: ", "*** Update File: ", "*** Move to: "] as const;
	for (const prefix of prefixes) {
		if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
	}
	return undefined;
}

function addPatchFiles(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		addStringValue(paths, item["path"]);
		addStringValue(paths, item["filePath"]);
		addStringValue(paths, item["movePath"]);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

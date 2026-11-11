import { extractMutatedFilePaths as extractSharedMutatedFilePaths, MUTATION_TOOL_NAMES } from "../post-mutation/post-mutation";
import {
	collectPostEditDiagnostics,
	createPostEditNotConfiguredCache,
	resetPostEditNotConfiguredCache,
	type PostEditDiagnosticsOutcome,
	type PostEditFileLocation,
	type PostEditNotConfiguredCache,
} from "@oh-my-opencode/lsp-core/post-edit";

export type DiagnosticsRunner = (filePath: string) => Promise<PostEditDiagnosticsOutcome>;

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
	/** lsp-core marks missing-server guidance `false`: a note about the tool, never a code error. */
	readonly blocking: boolean;
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
	locateFile?: (filePath: string) => PostEditFileLocation,
): Promise<PostEditDiagnosticsResult | undefined> {
	if (!shouldRunPostEditDiagnostics(event)) return undefined;

	const filePaths = extractMutatedFilePaths(event);
	if (filePaths.length === 0) return undefined;

	const result = await collectPostEditDiagnostics({
		filePaths,
		runDiagnostics,
		cache,
		maxConcurrency: POST_EDIT_DIAGNOSTICS_CONCURRENCY,
		...(locateFile === undefined ? {} : { locateFile }),
	});
	const blocks: readonly DiagnosticBlock[] = result.blocks;

	if (blocks.length === 0) {
		return { widgetLines: undefined };
	}

	return {
		content: [
			...event.content,
			// Missing-server guidance is non-blocking (lsp-core blocking: false): it is a note about the tool, not a
			// defect in the edit, so it never reads as "please fix" (#13126; the codex hook treats it the same way).
			...blocks.map(({ filePath, diagnostics, blocking }) => ({
				type: "text" as const,
				text: blocking
					? `\n\nLSP errors detected in ${filePath}, please fix:\n${diagnostics}`
					: `\n\nLSP note for ${filePath} (the edit itself is not affected):\n${diagnostics}`,
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

export const extractMutatedFilePaths = extractSharedMutatedFilePaths;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

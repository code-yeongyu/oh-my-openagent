import type { MarkdownTheme } from "@earendil-works/pi-tui";
import type { SessionMessageEntry } from "../../../session-manager.ts";

export interface SessionHudEntry {
	readonly id: string;
	readonly shortId: string;
	readonly path: string;
	readonly cwd: string;
	readonly createdAt: number;
	readonly modifiedAt: number;
	readonly messageCount: number;
	readonly lastUserText: string;
	readonly isCurrent: boolean;
}

export interface TranscriptSnapshot {
	readonly entries: readonly SessionMessageEntry[];
	readonly model?: string;
}

export interface ViewerEntryRange {
	readonly lineStart: number;
	readonly lineCount: number;
	readonly kind: "thinking" | "response" | "tool" | "user" | "system";
}

export interface RenderedTranscript {
	readonly lines: readonly string[];
	readonly ranges: readonly ViewerEntryRange[];
}

export interface TranscriptRenderOptions {
	readonly width: number;
	readonly selectedIndex: number;
	readonly expandedEntries: ReadonlySet<number>;
	readonly markdownTheme?: MarkdownTheme;
}

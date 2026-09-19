import { openSync, closeSync, fstatSync, readSync } from "node:fs";

/** Only the tail matters: injected markers live at the end of a live session. */
export const TRANSCRIPT_TAIL_BYTES = 512_000;

/**
 * Markers that mean the context window is already under pressure. Injecting
 * more context there makes the session worse, so every injecting hook bails out.
 */
export const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"context_too_large",
	"context low",
	"skill descriptions were shortened",
	"your input exceeds the context window",
	"long threads and multiple compactions",
	"conversation was summarized",
] as const;

export function readTranscriptTail(transcriptPath: string | null | undefined): string {
	if (transcriptPath === null || transcriptPath === undefined || transcriptPath.length === 0) return "";
	try {
		const fd = openSync(transcriptPath, "r");
		try {
			const size = fstatSync(fd).size;
			const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
			const length = size - start;
			if (length <= 0) return "";
			const buffer = Buffer.alloc(length);
			readSync(fd, buffer, 0, length, start);
			return buffer.toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return "";
	}
}

export function transcriptContains(transcriptPath: string | null | undefined, needle: string): boolean {
	if (needle.length === 0) return false;
	return readTranscriptTail(transcriptPath).includes(needle);
}

export function transcriptShowsContextPressure(transcriptPath: string | null | undefined): boolean {
	const tail = readTranscriptTail(transcriptPath);
	if (tail.length === 0) return false;
	return textShowsContextPressure(tail);
}

export function textShowsContextPressure(text: string): boolean {
	const normalized = text.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => normalized.includes(marker));
}

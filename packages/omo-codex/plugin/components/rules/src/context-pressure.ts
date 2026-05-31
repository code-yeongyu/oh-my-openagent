import { readFileSync } from "node:fs";

const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

export function hasContextPressureMarker(text: string): boolean {
	const normalizedText = text.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}

export function transcriptHasContextPressureMarker(transcriptPath: string | null | undefined): boolean {
	if (transcriptPath === undefined || transcriptPath === null) return false;
	try {
		return hasContextPressureMarker(readFileSync(transcriptPath, "utf8"));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { normalizeApplyPatchArguments } from "./params.ts";
import { renderPatchLine } from "./preview-format.ts";
import { StreamingPatchParser } from "./streaming-parser.ts";
import { extractPatchedPaths } from "./text.ts";
import type { ApplyPatchParams, ApplyPatchRenderState, ApplyPatchTheme, ParsedPatch } from "./types.ts";

function hunkOperation(hunk: ParsedPatch): string {
	if (hunk.type === "add") return "Added";
	if (hunk.type === "delete") return "Deleted";
	return hunk.movePath ? "Moved" : "Edited";
}

function hunkPath(hunk: ParsedPatch): string {
	return hunk.type === "update" && hunk.movePath ? `${hunk.filePath} → ${hunk.movePath}` : hunk.filePath;
}

function hunkDiffLines(hunk: ParsedPatch): string[] {
	if (hunk.type === "delete") return [];
	if (hunk.type === "add")
		return hunk.content
			.split("\n")
			.filter(Boolean)
			.map((line) => `  + ${line}`);
	return hunk.chunks.flatMap((chunk) => [
		...chunk.changeContexts.map((context) => `  @@ ${context}`),
		...chunk.oldLines.map((line) => `  - ${line}`),
		...chunk.newLines.map((line) => `  + ${line}`),
	]);
}

function formatStreamingHunks(hunks: ParsedPatch[]): string {
	return hunks.flatMap((hunk) => [`• ${hunkOperation(hunk)} ${hunkPath(hunk)}`, ...hunkDiffLines(hunk)]).join("\n");
}

function updateStreamingState(input: string, state: ApplyPatchRenderState): ParsedPatch[] {
	if (!state.streamingParser || !input.startsWith(state.streamingInput ?? "")) {
		state.streamingParser = new StreamingPatchParser();
		state.streamingInput = "";
		state.streamingHunks = [];
		state.streamingError = undefined;
	}

	const previousInput = state.streamingInput ?? "";
	const delta = input.slice(previousInput.length);
	try {
		state.streamingHunks = state.streamingParser.pushDelta(delta);
		state.streamingInput = input;
		state.streamingError = undefined;
	} catch (error) {
		state.streamingError = error instanceof Error ? error.message : "Invalid patch stream";
	}
	return state.streamingHunks ?? [];
}

function renderBox(title: string, body: string, theme: ApplyPatchTheme): Container {
	const component = new Container();
	const box = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
	box.addChild(new Text(theme.fg("toolTitle", theme.bold(title)), 0, 0));
	box.addChild(new Spacer(1));
	box.addChild(
		new Text(
			body
				.split("\n")
				.map((line) => renderPatchLine(line, theme))
				.join("\n"),
			0,
			0,
		),
	);
	component.addChild(box);
	return component;
}

export function renderStreamingPatchCall(
	args: ApplyPatchParams,
	theme: ApplyPatchTheme,
	state: ApplyPatchRenderState,
): Container | undefined {
	const input = normalizeApplyPatchArguments(args).input;
	if (!input) return undefined;
	const hunks = updateStreamingState(input, state);
	if (state.streamingError) return renderBox("Invalid patch stream", state.streamingError, theme);
	if (hunks.length > 0) return renderBox("Applying patch", formatStreamingHunks(hunks), theme);
	const paths = extractPatchedPaths(input);
	if (paths.length === 0) return undefined;
	return renderBox("Applying patch", paths.map((filePath) => `• ${filePath}`).join("\n"), theme);
}

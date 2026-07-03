import path from "node:path";
import { renderToolDiff } from "../../../tools/diff-render.ts";
import { parsePatch } from "./parser.ts";
import { extractPatchedPaths } from "./text.ts";
import type {
	ApplyPatchOperation,
	ApplyPatchPreview,
	ApplyPatchPreviewFile,
	ApplyPatchRenderState,
	ApplyPatchTheme,
} from "./types.ts";

export const PATCH_PREVIEW_MAX_LINES = 16;
export const PATCH_PREVIEW_MAX_CHARS = 4000;
const PATCH_PREVIEW_HEAD_LINES = 8;
const PATCH_PREVIEW_TAIL_LINES = PATCH_PREVIEW_MAX_LINES - PATCH_PREVIEW_HEAD_LINES - 1;
const PATCH_PREVIEW_TRUNCATION_MARKER = "…";
const applyPatchRenderStates = new Map<string, ApplyPatchRenderState>();

function isChangedPreviewLine(line: string): boolean {
	return /^[+-]\s*\d+\s/.test(line);
}

function countWindowLines(lines: string[], start: number, end: number): number {
	return end - start + (start > 0 ? 1 : 0) + (end < lines.length ? 1 : 0);
}

function formatPreviewWindow(lines: string[], start: number, end: number): string {
	const previewLines = lines.slice(start, end);
	if (start > 0) previewLines.unshift("…");
	if (end < lines.length) previewLines.push("…");
	return previewLines.join("\n");
}

function createChangedHunkPreview(lines: string[]): string | undefined {
	const firstChangedLine = lines.findIndex(isChangedPreviewLine);
	if (firstChangedLine === -1) return undefined;

	let start = firstChangedLine;
	let end = firstChangedLine + 1;
	while (end < lines.length) {
		const line = lines[end];
		if (line === undefined || !isChangedPreviewLine(line)) break;
		end++;
	}

	const changedHunkEnd = end;
	while (end > start && countWindowLines(lines, start, end) > PATCH_PREVIEW_MAX_LINES) end--;

	while (countWindowLines(lines, start, end) < PATCH_PREVIEW_MAX_LINES) {
		const canAddBefore = start > 0;
		const canAddAfter = end < lines.length;
		if (!canAddBefore && !canAddAfter) break;

		const beforeContextLines = firstChangedLine - start;
		const afterContextLines = end - changedHunkEnd;
		if (canAddBefore && (!canAddAfter || beforeContextLines <= afterContextLines)) {
			start--;
		} else {
			end++;
		}
	}

	return formatPreviewWindow(lines, start, end);
}

function formatLineCountSummary(added: number, removed: number): string {
	return `(+${added} -${removed})`;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	let lines = 1;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

function enforcePreviewCharLimit(preview: string): string {
	if (preview.length <= PATCH_PREVIEW_MAX_CHARS) return preview;
	return `${preview.slice(0, PATCH_PREVIEW_MAX_CHARS - PATCH_PREVIEW_TRUNCATION_MARKER.length).trimEnd()}${PATCH_PREVIEW_TRUNCATION_MARKER}`;
}

export function truncatePreview(text: string): string {
	if (text.length <= PATCH_PREVIEW_MAX_CHARS && countLines(text) <= PATCH_PREVIEW_MAX_LINES) return text;
	const lines = text.split("\n");
	const changedHunkPreview = createChangedHunkPreview(lines);
	const preview =
		changedHunkPreview ??
		[...lines.slice(0, PATCH_PREVIEW_HEAD_LINES), "…", ...lines.slice(-PATCH_PREVIEW_TAIL_LINES)].join("\n");
	return enforcePreviewCharLimit(preview);
}

export function displayPath(filePath: string, cwd: string): string {
	if (!path.isAbsolute(filePath)) return filePath;
	const absoluteCwd = path.resolve(cwd);
	const relativePath = path.relative(absoluteCwd, filePath);
	if (
		relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
	) {
		return relativePath || ".";
	}
	return filePath;
}

function formatPatchFilePath(file: ApplyPatchPreviewFile, cwd: string = process.cwd()): string {
	const filePath = displayPath(file.filePath, cwd);
	if (!file.movePath) return filePath;
	return `${filePath} → ${displayPath(file.movePath, cwd)}`;
}

function formatPatchOperation(operation: ApplyPatchOperation): string {
	if (operation === "add") return "Added";
	if (operation === "delete") return "Deleted";
	return "Edited";
}

export function formatPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string = process.cwd(),
	expanded: boolean = true,
): string {
	const lines: string[] = [];
	if (preview.files.length === 1) {
		const file = preview.files[0];
		if (file) {
			lines.push(
				`• ${formatPatchOperation(file.operation)} ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`,
			);
			if (expanded && file.diff)
				lines.push(
					...truncatePreview(file.diff)
						.split("\n")
						.map((line) => `  ${line}`),
				);
		}
		return lines.join("\n");
	}

	const noun = preview.files.length === 1 ? "file" : "files";
	lines.push(`• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}`);
	for (const file of preview.files) {
		lines.push(`  └ ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`);
		if (expanded && file.diff)
			lines.push(
				...truncatePreview(file.diff)
					.split("\n")
					.map((line) => `    ${line}`),
			);
	}
	return lines.join("\n");
}

export function formatInFlightCallText(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) return "Patching";
	const noun = paths.length === 1 ? "file" : "files";
	const count = paths.length > 1 ? ` (${paths.length} ${noun})` : "";
	return `Patching${count}: ${paths.join(", ")}`;
}

export function getApplyPatchRenderState(toolCallId: string, cwd: string, patchText: string): ApplyPatchRenderState {
	const existing = applyPatchRenderStates.get(toolCallId);
	if (existing && existing.cwd === cwd && existing.patchText === patchText) return existing;

	const callText = formatInFlightCallText(patchText);
	let collapsed = "";
	let expanded = "";
	try {
		const hunks = parsePatch(patchText);
		if (hunks.length > 0) {
			const files = hunks.map((hunk) => ({
				filePath: hunk.filePath,
				movePath: hunk.type === "update" ? hunk.movePath : undefined,
				operation: hunk.type,
				diff: "",
				added: 0,
				removed: 0,
			})) satisfies ApplyPatchPreviewFile[];
			const preview: ApplyPatchPreview = { files, added: 0, removed: 0 };
			collapsed = formatPatchPreview(preview, cwd, false);
			expanded = formatPatchPreview(preview, cwd, true);
		}
	} catch {
		// ignore incomplete patch text
	}

	const nextState: ApplyPatchRenderState = { ...existing, cwd, patchText, callText, collapsed, expanded };
	applyPatchRenderStates.set(toolCallId, nextState);
	return nextState;
}

export function clearApplyPatchRenderState(): void {
	applyPatchRenderStates.clear();
}

export function renderPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string,
	theme: ApplyPatchTheme,
	expanded: boolean,
): string {
	if (expanded) {
		try {
			const renderFile = (file: ApplyPatchPreviewFile, headerPrefix: string): string => {
				const header = `• ${formatPatchOperation(file.operation)} ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`;
				if (!file.diff) {
					return headerPrefix.length > 0
						? `${headerPrefix}${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`
						: header;
				}

				const renderedDiff = renderToolDiff(truncatePreview(file.diff), {
					filePath: file.movePath ?? file.filePath,
					theme,
				});
				if (headerPrefix.length > 0) {
					const nestedHeader = `${headerPrefix}${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`;
					return `${nestedHeader}\n${renderedDiff
						.split("\n")
						.map((line) => `    ${line}`)
						.join("\n")}`;
				}
				return `${header}\n${renderedDiff}`;
			};

			if (preview.files.length === 1) {
				const file = preview.files[0];
				return file ? renderFile(file, "") : "";
			}

			const noun = preview.files.length === 1 ? "file" : "files";
			const renderedFiles = preview.files.map((file) => renderFile(file, "  └ ")).join("\n");
			if (renderedFiles.length > 0) {
				return `• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}\n${renderedFiles}`;
			}
		} catch {
			// fall back to manual themed line rendering
		}
	}

	return formatPatchPreview(preview, cwd, expanded)
		.split("\n")
		.map((line) => renderPatchLine(line, theme))
		.join("\n");
}

export function formatPendingPatchPaths(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) return "Applying patch...";
	return `Applying patch...\n${paths.map((filePath) => `• ${filePath}`).join("\n")}`;
}

export function renderPatchLine(line: string, theme: ApplyPatchTheme): string {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("+")) return theme.fg("toolDiffAdded", line);
	if (trimmed.startsWith("-")) return theme.fg("toolDiffRemoved", line);
	if (trimmed.startsWith("•")) return theme.fg("toolTitle", theme.bold(line));
	if (trimmed.startsWith("└")) return theme.fg("accent", line);
	return theme.fg("toolDiffContext", line);
}

import * as Diff from "diff";
import { getLanguageFromPath, highlightCode } from "../../modes/interactive/theme/theme.ts";

export type ToolDiffThemeColor = "muted" | "toolDiffAdded" | "toolDiffContext" | "toolDiffRemoved";
export type ToolDiffThemeBg = "toolErrorBg" | "toolSuccessBg";

export type ToolDiffTheme = {
	fg: (name: ToolDiffThemeColor, text: string) => string;
	bg: (name: ToolDiffThemeBg, text: string) => string;
	inverse: (text: string) => string;
};

export type RenderToolDiffOptions = {
	filePath?: string;
	theme: ToolDiffTheme;
};

type RenderableAddedDiffLine = { content: string; kind: "added"; lineNumber: string; sign: "+" };
type RenderableRemovedDiffLine = { content: string; kind: "removed"; lineNumber: string; sign: "-" };
type RenderableContextDiffLine = { content: string; kind: "context"; lineNumber: string; sign: " " };
type RenderableContentDiffLine = RenderableAddedDiffLine | RenderableContextDiffLine | RenderableRemovedDiffLine;
type RenderableDiffLine = RenderableContentDiffLine | { kind: "meta"; text: string };

function parseRenderableDiffLine(line: string): RenderableDiffLine {
	const match = line.match(/^([+\- ])(\s*\d*)\s(.*)$/);
	if (!match) return { kind: "meta", text: line };

	const sign = match[1];
	const lineNumber = match[2];
	if ((sign !== "+" && sign !== "-" && sign !== " ") || lineNumber === undefined) return { kind: "meta", text: line };

	const content = match[3] ?? "";
	if (sign === "+") return { content, kind: "added", lineNumber, sign };
	if (sign === "-") return { content, kind: "removed", lineNumber, sign };
	return { content, kind: "context", lineNumber, sign };
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function highlightDiffContent(content: string, filePath: string | undefined): string {
	const plainContent = replaceTabs(content);
	if (!filePath) return plainContent;
	const language = getLanguageFromPath(filePath);
	try {
		return highlightCode(plainContent, language)[0] ?? plainContent;
	} catch {
		return plainContent;
	}
}

function renderInlineDiff(
	oldContent: string,
	newContent: string,
	theme: ToolDiffTheme,
): { added: string; removed: string } {
	const parts = Diff.diffWords(replaceTabs(oldContent), replaceTabs(newContent));
	let added = "";
	let removed = "";
	let firstAdded = true;
	let firstRemoved = true;

	for (const part of parts) {
		if (part.added) {
			let value = part.value;
			if (firstAdded) {
				const leadingWhitespace = value.match(/^(\s*)/)?.[1] ?? "";
				added += leadingWhitespace;
				value = value.slice(leadingWhitespace.length);
				firstAdded = false;
			}
			if (value) added += theme.inverse(value);
			continue;
		}

		if (part.removed) {
			let value = part.value;
			if (firstRemoved) {
				const leadingWhitespace = value.match(/^(\s*)/)?.[1] ?? "";
				removed += leadingWhitespace;
				value = value.slice(leadingWhitespace.length);
				firstRemoved = false;
			}
			if (value) removed += theme.inverse(value);
			continue;
		}

		added += part.value;
		removed += part.value;
	}

	return { added, removed };
}

function renderToolDiffLine(
	line: RenderableContentDiffLine,
	filePath: string | undefined,
	theme: ToolDiffTheme,
	contentOverride?: string,
): string {
	const lineNumber = theme.fg("muted", line.lineNumber);
	if (line.kind === "context") {
		return `${theme.fg("toolDiffContext", line.sign)}${lineNumber} ${highlightDiffContent(line.content, filePath)}`;
	}

	const diffColor = line.kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
	const background = line.kind === "added" ? "toolSuccessBg" : "toolErrorBg";
	const content =
		contentOverride === undefined
			? highlightDiffContent(line.content, filePath)
			: theme.fg(diffColor, replaceTabs(contentOverride));
	const rendered = `${theme.fg(diffColor, line.sign)}${lineNumber} ${content}`;
	return theme.bg(background, rendered);
}

export function renderToolDiff(diffText: string, options: RenderToolDiffOptions): string {
	const parsedLines = diffText.split("\n").map(parseRenderableDiffLine);
	const rendered: string[] = [];
	let index = 0;

	while (index < parsedLines.length) {
		const line = parsedLines[index];
		if (!line) {
			index++;
			continue;
		}

		if (line.kind !== "removed") {
			rendered.push(
				line.kind === "meta"
					? options.theme.fg("toolDiffContext", line.text)
					: renderToolDiffLine(line, options.filePath, options.theme),
			);
			index++;
			continue;
		}

		const removedLines: RenderableRemovedDiffLine[] = [];
		while (parsedLines[index]?.kind === "removed") {
			const removedLine = parsedLines[index];
			if (removedLine?.kind === "removed") removedLines.push(removedLine);
			index++;
		}

		const addedLines: RenderableAddedDiffLine[] = [];
		while (parsedLines[index]?.kind === "added") {
			const addedLine = parsedLines[index];
			if (addedLine?.kind === "added") addedLines.push(addedLine);
			index++;
		}

		const pairedCount = Math.min(removedLines.length, addedLines.length);
		for (let pairIndex = 0; pairIndex < pairedCount; pairIndex++) {
			const removedLine = removedLines[pairIndex];
			const addedLine = addedLines[pairIndex];
			if (!removedLine || !addedLine) continue;

			const inline = renderInlineDiff(removedLine.content, addedLine.content, options.theme);
			rendered.push(renderToolDiffLine(removedLine, options.filePath, options.theme, inline.removed));
			rendered.push(renderToolDiffLine(addedLine, options.filePath, options.theme, inline.added));
		}

		for (const removedLine of removedLines.slice(pairedCount))
			rendered.push(renderToolDiffLine(removedLine, options.filePath, options.theme));
		for (const addedLine of addedLines.slice(pairedCount))
			rendered.push(renderToolDiffLine(addedLine, options.filePath, options.theme));
	}

	return rendered.join("\n");
}

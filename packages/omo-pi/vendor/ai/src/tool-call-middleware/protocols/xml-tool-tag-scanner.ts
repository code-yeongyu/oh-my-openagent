export type XmlToolTagMatch = {
	index: number;
	name: string;
	tag: string;
	selfClosing: boolean;
};

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findSelfClosingToolTag(
	text: string,
	toolName: string,
	fromIndex: number,
): { index: number; length: number; tag: string } | null {
	const pattern = new RegExp(`<\\s*${escapeRegExp(toolName)}\\s*\\/\\s*>`, "g");
	pattern.lastIndex = fromIndex;
	const match = pattern.exec(text);
	if (!match || match.index === undefined) {
		return null;
	}
	return { index: match.index, length: match[0].length, tag: match[0] };
}

export function findEarliestXmlToolTag(text: string, toolNames: string[]): XmlToolTagMatch | null {
	let earliestTag: XmlToolTagMatch | null = null;

	for (const toolName of toolNames) {
		const tagPattern = new RegExp(`<\\s*${escapeRegExp(toolName)}\\s*(\\/)?\\s*>`);
		const match = tagPattern.exec(text);
		if (!match || match.index === undefined) {
			continue;
		}

		if (!earliestTag || match.index < earliestTag.index) {
			earliestTag = {
				index: match.index,
				name: toolName,
				tag: match[0],
				selfClosing: match[1] === "/",
			};
		}
	}

	return earliestTag;
}

export function getSafeXmlTextLength(text: string, toolNames: string[]): number {
	const lastTagIndex = text.lastIndexOf("<");
	if (lastTagIndex === -1) {
		return text.length;
	}

	const trailingCandidate = text.slice(lastTagIndex);
	const hasPotentialToolStart = toolNames.some((toolName) => {
		const candidates = [
			`<${toolName}>`,
			`<${toolName}/>`,
			`< ${toolName}>`,
			`< ${toolName}/>`,
			`<${toolName} />`,
			`< ${toolName} />`,
		];
		return candidates.some((candidate) => candidate.startsWith(trailingCandidate));
	});
	if (!hasPotentialToolStart) {
		return text.length;
	}

	return lastTagIndex;
}

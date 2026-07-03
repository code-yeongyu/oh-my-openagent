function normalizeSeekLine(line: string): string {
	return line
		.trim()
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

export function seekSequenceWithFuzz(
	lines: string[],
	pattern: string[],
	start: number,
	eof: boolean,
): { index: number; fuzz: 0 | 1 | 100 | 10000 } | undefined {
	if (pattern.length === 0) {
		return { index: start, fuzz: 0 };
	}
	if (pattern.length > lines.length) {
		return undefined;
	}

	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
	const lastStart = lines.length - pattern.length;
	const matches = (index: number, compare: (left: string, right: string) => boolean): boolean => {
		for (let patternIndex = 0; patternIndex < pattern.length; patternIndex++) {
			const line = lines[index + patternIndex];
			const expected = pattern[patternIndex];
			if (line === undefined || expected === undefined || !compare(line, expected)) {
				return false;
			}
		}
		return true;
	};

	for (let index = searchStart; index <= lastStart; index++) {
		if (matches(index, (line, expected) => line === expected)) return { index, fuzz: 0 };
	}
	for (let index = searchStart; index <= lastStart; index++) {
		if (matches(index, (line, expected) => line.trimEnd() === expected.trimEnd())) return { index, fuzz: 1 };
	}
	for (let index = searchStart; index <= lastStart; index++) {
		if (matches(index, (line, expected) => line.trim() === expected.trim())) return { index, fuzz: 100 };
	}
	for (let index = searchStart; index <= lastStart; index++) {
		if (matches(index, (line, expected) => normalizeSeekLine(line) === normalizeSeekLine(expected)))
			return { index, fuzz: 10000 };
	}

	return undefined;
}

export function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): number | undefined {
	return seekSequenceWithFuzz(lines, pattern, start, eof)?.index;
}

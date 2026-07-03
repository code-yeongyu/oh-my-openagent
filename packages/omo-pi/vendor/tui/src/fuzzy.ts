/**
 * Fuzzy matching utilities.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */

export interface FuzzyMatch {
	matches: boolean;
	score: number;
}

const ALPHANUMERIC_SWAP_PENALTY = 5;

function isAsciiLetter(char: string | undefined): boolean {
	if (!char) {
		return false;
	}
	const code = char.charCodeAt(0);
	return code >= 97 && code <= 122;
}

function isAsciiDigit(char: string | undefined): boolean {
	if (!char) {
		return false;
	}
	const code = char.charCodeAt(0);
	return code >= 48 && code <= 57;
}

function isWordBoundaryPrefix(char: string): boolean {
	switch (char) {
		case " ":
		case "\t":
		case "\n":
		case "\r":
		case "-":
		case "_":
		case ".":
		case "/":
		case ":":
			return true;
		default:
			return false;
	}
}

function scoreMatch(queryLower: string, textLower: string): FuzzyMatch {
	if (queryLower.length === 0) {
		return { matches: true, score: 0 };
	}

	if (queryLower.length > textLower.length) {
		return { matches: false, score: 0 };
	}

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
		if (textLower[i] === queryLower[queryIndex]) {
			const isWordBoundary = i === 0 || isWordBoundaryPrefix(textLower[i - 1]!);

			// Reward consecutive matches
			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				// Penalize gaps
				if (lastMatchIndex >= 0) {
					score += (i - lastMatchIndex - 1) * 2;
				}
			}

			// Reward word boundary matches
			if (isWordBoundary) {
				score -= 10;
			}

			// Slight penalty for later matches
			score += i * 0.1;

			lastMatchIndex = i;
			queryIndex++;
		}
	}

	if (queryIndex < queryLower.length) {
		return { matches: false, score: 0 };
	}

	if (queryLower === textLower) {
		score -= 100;
	}

	return { matches: true, score };
}

function addWholeTokenSwap(variants: Set<string>, queryLower: string): void {
	let splitIndex = 0;
	while (splitIndex < queryLower.length && isAsciiLetter(queryLower[splitIndex])) {
		splitIndex++;
	}
	if (splitIndex > 0 && splitIndex < queryLower.length) {
		let digitEnd = splitIndex;
		while (digitEnd < queryLower.length && isAsciiDigit(queryLower[digitEnd])) {
			digitEnd++;
		}
		if (digitEnd === queryLower.length) {
			variants.add(queryLower.slice(splitIndex) + queryLower.slice(0, splitIndex));
		}
	}

	splitIndex = 0;
	while (splitIndex < queryLower.length && isAsciiDigit(queryLower[splitIndex])) {
		splitIndex++;
	}
	if (splitIndex > 0 && splitIndex < queryLower.length) {
		let letterEnd = splitIndex;
		while (letterEnd < queryLower.length && isAsciiLetter(queryLower[letterEnd])) {
			letterEnd++;
		}
		if (letterEnd === queryLower.length) {
			variants.add(queryLower.slice(splitIndex) + queryLower.slice(0, splitIndex));
		}
	}
}

function buildAlphanumericSwapQueries(queryLower: string): string[] {
	const variants = new Set<string>();
	addWholeTokenSwap(variants, queryLower);

	for (let i = 0; i < queryLower.length - 1; i++) {
		const current = queryLower[i];
		const next = queryLower[i + 1];
		const isAlphaNumSwap =
			(isAsciiLetter(current) && isAsciiDigit(next)) || (isAsciiDigit(current) && isAsciiLetter(next));
		if (!isAlphaNumSwap) {
			continue;
		}
		variants.add(queryLower.slice(0, i) + next + current + queryLower.slice(i + 2));
	}

	return [...variants];
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();

	const direct = scoreMatch(queryLower, textLower);
	if (direct.matches) {
		return direct;
	}

	let bestSwap: FuzzyMatch | null = null;
	for (const variant of buildAlphanumericSwapQueries(queryLower)) {
		const match = scoreMatch(variant, textLower);
		if (!match.matches) {
			continue;
		}
		const score = match.score + ALPHANUMERIC_SWAP_PENALTY;
		if (!bestSwap || score < bestSwap.score) {
			bestSwap = { matches: true, score };
		}
	}

	return bestSwap ?? direct;
}

/**
 * Filter and sort items by fuzzy match quality (best matches first).
 * Supports whitespace- and slash-separated tokens: all tokens must match.
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	if (!query.trim()) {
		return items;
	}

	const tokens = query
		.trim()
		.split(/[\s/]+/)
		.filter((t) => t.length > 0);

	if (tokens.length === 0) {
		return items;
	}

	const results: { item: T; totalScore: number }[] = [];

	for (const item of items) {
		const text = getText(item);
		let totalScore = 0;
		let allMatch = true;

		for (const token of tokens) {
			const match = fuzzyMatch(token, text);
			if (match.matches) {
				totalScore += match.score;
			} else {
				allMatch = false;
				break;
			}
		}

		if (allMatch) {
			results.push({ item, totalScore });
		}
	}

	results.sort((a, b) => a.totalScore - b.totalScore);
	return results.map((r) => r.item);
}

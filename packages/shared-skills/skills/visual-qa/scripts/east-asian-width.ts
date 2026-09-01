interface CodePointRange {
	readonly start: number
	readonly end: number
}

// Combining marks and zero-width code points advance the cursor by 0 columns.
const ZERO_WIDTH_RANGES: readonly CodePointRange[] = [
	{ start: 0x0300, end: 0x036f }, // combining diacritical marks
	{ start: 0x0483, end: 0x0489 }, // combining Cyrillic
	{ start: 0x0591, end: 0x05bd }, // Hebrew points
	{ start: 0x0610, end: 0x061a }, // Arabic marks
	{ start: 0x064b, end: 0x065f }, // Arabic marks
	{ start: 0x0670, end: 0x0670 }, // Arabic superscript alef
	{ start: 0x06d6, end: 0x06dc }, // Arabic small high marks
	{ start: 0x1160, end: 0x11ff }, // Hangul Jamo medial/final (combining)
	{ start: 0x200b, end: 0x200f }, // zero-width space / directional marks
	{ start: 0x202a, end: 0x202e }, // bidi embeddings
	{ start: 0x2060, end: 0x2064 }, // word joiner / invisible operators
	{ start: 0x20d0, end: 0x20ff }, // combining marks for symbols
	{ start: 0xfe20, end: 0xfe2f }, // combining half marks
	{ start: 0xfeff, end: 0xfeff }, // zero-width no-break space (BOM)
]

// East Asian Wide + Fullwidth code points advance the cursor by 2 columns.
const WIDE_RANGES: readonly CodePointRange[] = [
	{ start: 0x1100, end: 0x115f }, // Hangul Jamo (leading consonants)
	{ start: 0x231a, end: 0x231b }, // watch / hourglass
	{ start: 0x2e80, end: 0x303e }, // CJK radicals, Kangxi, CJK symbols
	{ start: 0x3041, end: 0x33ff }, // Kana, Bopomofo, CJK compatibility
	{ start: 0x3400, end: 0x4dbf }, // CJK Unified Ext A
	{ start: 0x4e00, end: 0x9fff }, // CJK Unified Ideographs
	{ start: 0xa000, end: 0xa4cf }, // Yi syllables
	{ start: 0xa960, end: 0xa97f }, // Hangul Jamo Ext-A
	{ start: 0xac00, end: 0xd7a3 }, // Hangul syllables
	{ start: 0xf900, end: 0xfaff }, // CJK compatibility ideographs
	{ start: 0xfe10, end: 0xfe19 }, // vertical forms
	{ start: 0xfe30, end: 0xfe6f }, // CJK compatibility / small forms
	{ start: 0xff00, end: 0xff60 }, // fullwidth forms (halfwidth starts at 0xff61)
	{ start: 0xffe0, end: 0xffe6 }, // fullwidth signs
	{ start: 0x1b000, end: 0x1b16f }, // Kana supplement / extended
	{ start: 0x1f200, end: 0x1f2ff }, // enclosed ideographic supplement
	{ start: 0x1f300, end: 0x1faff }, // emoji and pictographs
	{ start: 0x20000, end: 0x3fffd }, // CJK Unified Ext B and beyond
]

function inRanges(codePoint: number, ranges: readonly CodePointRange[]): boolean {
	for (const range of ranges) {
		if (codePoint >= range.start && codePoint <= range.end) {
			return true
		}
	}
	return false
}

export function charWidth(codePoint: number): 0 | 1 | 2 {
	if (codePoint === 0) return 0
	if (codePoint < 0x20) return 0 // C0 control
	if (codePoint >= 0x7f && codePoint <= 0x9f) return 0 // DEL and C1 control
	if (inRanges(codePoint, ZERO_WIDTH_RANGES)) return 0
	if (inRanges(codePoint, WIDE_RANGES)) return 2
	return 1
}

export function stringWidth(text: string): number {
	let total = 0
	for (const char of text) {
		const codePoint = char.codePointAt(0)
		if (codePoint === undefined) continue
		total += charWidth(codePoint)
	}
	return total
}

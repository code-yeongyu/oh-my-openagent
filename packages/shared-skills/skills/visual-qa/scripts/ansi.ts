const ESC = String.fromCharCode(0x1b)
const CSI = String.fromCharCode(0x9b)

// Matches CSI/escape sequences (colors, cursor moves) without embedding raw
// control characters in the regex source.
const ANSI_PATTERN = new RegExp(
	`[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
	"g",
)

export function stripAnsi(input: string): string {
	return input.replace(ANSI_PATTERN, "")
}

export function hasAnsi(input: string): boolean {
	return stripAnsi(input) !== input
}

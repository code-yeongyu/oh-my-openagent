import { log } from "../../shared"

const NULL_BYTE_REGEX = /\x00/g

function stripNullBytes(value: string): string {
	return value.replace(NULL_BYTE_REGEX, "")
}

export function sanitizeToolArgsNullBytes(
	input: { tool: string },
	output: { args: Record<string, unknown> },
): void {
	const argsObject = output.args
	let sanitized = false

	for (const [key, value] of Object.entries(argsObject)) {
		if (typeof value === "string" && value.includes("\x00")) {
			argsObject[key] = stripNullBytes(value)
			sanitized = true
		}
	}

	if (sanitized) {
		log("[null-byte-sanitizer] Stripped null bytes from tool args", {
			tool: input.tool,
		})
	}
}

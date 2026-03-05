import { log } from "../../shared"

const NULL_BYTE_REGEX = /\x00/g

function sanitizeValue(value: unknown): unknown {
	if (typeof value === "string") {
		return value.includes("\x00") ? value.replace(NULL_BYTE_REGEX, "") : value
	}
	if (Array.isArray(value)) {
		return value.map(sanitizeValue)
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = sanitizeValue(v)
		}
		return result
	}
	return value
}

export function sanitizeToolArgsNullBytes(
	input: { tool: string },
	output: { args: Record<string, unknown> },
): void {
	const argsObject = output.args
	let sanitized = false

	for (const [key, value] of Object.entries(argsObject)) {
		const cleaned = sanitizeValue(value)
		if (cleaned !== value) {
			argsObject[key] = cleaned
			sanitized = true
		}
	}

	if (sanitized) {
		log("[null-byte-sanitizer] Stripped null bytes from tool args", {
			tool: input.tool,
		})
	}
}

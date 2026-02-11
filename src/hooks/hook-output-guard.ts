/**
 * Safely appends text to a hook output's `output` field.
 *
 * MCP tools (Atlassian, Exa, Chrome DevTools, grep.app, etc.) can return
 * responses where `output.output` is `undefined` instead of a string.
 * This helper normalizes `null`/`undefined` to an empty string before
 * appending, preserving context injection while avoiding TypeError crashes.
 *
 * Non-string values (objects, arrays) are left untouched to prevent
 * corrupting structured tool responses.
 */
export function appendToOutput(
	output: { output: string },
	text: string,
): void {
	if (output.output == null) {
		output.output = text
		return
	}
	if (typeof output.output === "string") {
		output.output += text
	}
}

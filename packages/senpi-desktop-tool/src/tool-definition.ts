import { computerPreludeAssets } from "@oh-my-opencode/senpi-desktop-prelude";
import { ComputerParams } from "./params";

export const COMPUTER_TOOL_NAME = "computer";

const SEARCH_KEYWORDS = [
	"computer use",
	"computer-use",
	"cua",
	"desktop",
	"gui",
	"screenshot",
	"click",
	"type",
	"keyboard",
	"mouse",
	"window",
	"accessibility",
	"ax",
	"clipboard",
	"automation",
] as const;

const DESCRIPTION = [
	"Drive the user's real desktop (experimental): windows, screenshots, native mouse and keyboard input, the OS accessibility (AX) tree, and the clipboard. Not a browser.",
	'- `{action:"call", chain}` runs one desktop helper, optionally followed by one call on the window/element it returns, e.g. `[{method:"window",args:[{app:"Code"}]},{method:"screenshot"}]`.',
	'- `{action:"run", code, read_only?, timeout?}` runs a JavaScript async function body with `desktop`, `wait`, `assert`, and `tool` in scope; `read_only: true` blocks input.',
	'- `{action:"capabilities"}` reports backend, permissions, `stopPath`, and `focusGuard`. `{action:"close"}` ends the desktop session.',
	"Pass only the fields of the chosen action; any other field is refused with COMPUTER_INVALID_ARGUMENTS.",
	"In eval cells prefer the `computer` global, which wraps these actions. Pointer x,y are pixels of the latest screenshot of the same target.",
].join("\n");

/** Oh-my-pi's `computer-safety.md` bullets, taken from the prelude asset so the rules have one source. */
const SAFETY_GUIDELINES = computerPreludeAssets.safety
	.split("\n")
	.filter((line) => line.startsWith("- "))
	.map((line) => line.slice(2));

/**
 * The `computer` tool without `execute`: everything registration publishes (tool_search indexes it at
 * session_start), so a host can register the tool before it loads the implementation (#9113).
 */
export const computerToolDefinition = {
	name: COMPUTER_TOOL_NAME,
	label: "Computer",
	description: DESCRIPTION,
	exposure: "search" as const,
	searchText:
		"Operate the real desktop (experimental): screenshots, clicks, typing, key chords, window list, accessibility tree, clipboard; macOS/Linux/Windows",
	searchKeywords: SEARCH_KEYWORDS,
	searchGroup: "desktop",
	promptSnippet: "Operate the real desktop (experimental): screenshots, native input, accessibility tree, clipboard",
	promptGuidelines: SAFETY_GUIDELINES,
	kernelPrelude: computerPreludeAssets,
	parameters: ComputerParams,
	executionMode: "sequential" as const,
};

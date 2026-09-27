import {
	COMPUTER_DECLARATIONS,
	COMPUTER_DOCUMENTATION,
	COMPUTER_PRELUDE_JAVASCRIPT,
	COMPUTER_PRELUDE_PYTHON,
	COMPUTER_SAFETY,
} from "./assets.generated";

/**
 * Every method a `computer` call chain may name: the union of the protocol's desktop, window, and element tier
 * tables. The facades emit nothing else; `test/method-allowlist.test.ts` pins both directions.
 */
const METHOD_ALLOWLIST: readonly string[] = [
	"actions",
	"attributes",
	"ax",
	"bounds",
	"capabilities",
	"children",
	"click",
	"clipboard.read",
	"clipboard.write",
	"displays",
	"doubleClick",
	"drag",
	"elementAt",
	"find",
	"focus",
	"focusedElement",
	"focusedWindow",
	"move",
	"parent",
	"perform",
	"press",
	"raise",
	"ref",
	"screenshot",
	"scroll",
	"setValue",
	"type",
	"value",
	"window",
	"windows",
];

/**
 * The `computer` eval-kernel contribution plus its model docs. `javascript`, `python`, `documentation`, and
 * `exports` form the tool's `kernelPrelude`; each facade helper is one ordinary `tool.computer(...)` call.
 */
export const computerPreludeAssets = {
	javascript: COMPUTER_PRELUDE_JAVASCRIPT,
	python: COMPUTER_PRELUDE_PYTHON,
	/** TypeScript declarations of the JavaScript `computer` global. */
	declarations: COMPUTER_DECLARATIONS,
	/** Helper-list lines for the eval prompt's prelude block. */
	documentation: COMPUTER_DOCUMENTATION,
	/** System-prompt fragment for sessions where the `computer` tool is active. */
	safety: COMPUTER_SAFETY,
	exports: ["computer"],
	methodAllowlist: METHOD_ALLOWLIST,
} as const;

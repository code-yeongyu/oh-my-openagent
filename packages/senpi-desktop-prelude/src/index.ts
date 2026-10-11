import { preludeAssets } from "./assets";

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
	"menu.items",
	"menu.select",
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
 * The five texts load lazily from the generated JSON (`src/assets.ts`), so bundles that senpi re-transpiles
 * per session carry none of their bytes (#9113); the object's shape and every published byte are unchanged
 * (`test/assets-byte-identity.test.ts`).
 */
export const computerPreludeAssets = {
	get javascript(): string {
		return preludeAssets().COMPUTER_PRELUDE_JAVASCRIPT;
	},
	get python(): string {
		return preludeAssets().COMPUTER_PRELUDE_PYTHON;
	},
	/** TypeScript declarations of the JavaScript `computer` global. */
	get declarations(): string {
		return preludeAssets().COMPUTER_DECLARATIONS;
	},
	/** Helper-list lines for the eval prompt's prelude block. */
	get documentation(): string {
		return preludeAssets().COMPUTER_DOCUMENTATION;
	},
	/** System-prompt fragment for sessions where the `computer` tool is active. */
	get safety(): string {
		return preludeAssets().COMPUTER_SAFETY;
	},
	exports: ["computer"],
	methodAllowlist: METHOD_ALLOWLIST,
};

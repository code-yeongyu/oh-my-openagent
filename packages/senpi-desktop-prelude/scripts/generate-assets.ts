// Generates the kernel `computer` facades' method tables from the committed copy of the SDK facade manifest
// (`facade-manifest.json`), together with the protocol tier tables and the prelude METHOD_ALLOWLIST, then
// precompiles the prelude and doc assets into src/assets.generated.json, which src/assets.ts reads lazily, so the
// ~29 KB of prelude text never enters a bundle that senpi's extension loader re-transpiles at every session start
// (#9113). Runs first in `build`; `test/assets.test.ts` and `test/facade-manifest.test.ts` fail when a committed
// output drifts from what this script renders.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const protocolCallPath = join(packageDir, "..", "senpi-desktop-protocol", "src", "call.ts");
const protocolAllowlistTestPath = join(packageDir, "..", "senpi-desktop-protocol", "test", "method-allowlist.test.ts");
const helperNamesPath = join(packageDir, "test", "helper-names.ts");

/** JSON field name -> asset path relative to the package root. */
const ASSETS: Readonly<Record<string, string>> = {
	COMPUTER_PRELUDE_JAVASCRIPT: "src/prelude.js",
	COMPUTER_PRELUDE_PYTHON: "src/prelude.py",
	COMPUTER_DECLARATIONS: "declarations.d.ts",
	COMPUTER_DOCUMENTATION: "docs/computer.md",
	COMPUTER_SAFETY: "docs/computer-safety.md",
	COMPUTER_GUIDE: "docs/computer-guide.md",
};

const documentationPath = join(packageDir, "docs", "computer.md");

export const ASSETS_JSON_PATH = join(packageDir, "src", "assets.generated.json");
/** The prelude's committed copy of the SDK manifest; `test/facade-manifest.test.ts` pins it to the SDK's bytes. */
export const MANIFEST_COPY_PATH = join(packageDir, "facade-manifest.json");

export type Tier = "read" | "exec";
export type Surface = "desktop" | "display" | "window" | "element";

export interface ManifestMethod {
	readonly method: string;
	readonly tier: Tier;
	readonly wire: readonly string[];
}

/** A manifest entry with the signature fields the guide's method table prints. */
export interface ManifestEntry extends ManifestMethod {
	readonly params: readonly { readonly name: string; readonly optional: boolean }[];
	readonly returns: string;
	readonly policy: string;
}

/**
 * One call-chain method a kernel handle exposes. `source` is the SDK facade method it wraps, which supplies the
 * permission tier; `null` marks a helper the SDK facade has no method for yet, which then names its own tier.
 * `generic` helpers are emitted into the facades' generated method lists (one `tool.computer` call each, arguments
 * passed through); the others keep a hand-written signature in the facade transport (they resolve a handle or take
 * fixed parameters), and `test/helper-names.ts` checks that every one of them exists.
 */
export interface ChainBinding {
	readonly method: string;
	readonly source: string | null;
	readonly tier?: Tier;
	readonly generic: boolean;
}

/** A kernel helper composed from read-tier chain calls: no chain method and no wire method of its own. */
export interface ComposedHelper {
	readonly surface: Surface;
	readonly helper: string;
	readonly source: string;
	/** The chain methods the helper calls; each must be read-tier on every surface that has it. */
	readonly reads: readonly string[];
}

const INPUT_TARGET: readonly ChainBinding[] = [
	{ method: "screenshot", source: "Target.screenshot", generic: true },
	{ method: "zoom", source: "Frame.zoom", generic: true },
	{ method: "click", source: "Pointer.click", generic: true },
	{ method: "doubleClick", source: "Pointer.click", generic: true },
	{ method: "move", source: "Pointer.move", generic: true },
	{ method: "drag", source: "Pointer.drag", generic: true },
	{ method: "scroll", source: "Pointer.scroll", generic: true },
	{ method: "type", source: "Keyboard.type", generic: true },
	{ method: "press", source: "Keyboard.chord", generic: true },
	{ method: "holdKeys", source: "Keyboard.hold", generic: true },
	{ method: "holdMouse", source: "Pointer.hold", generic: true },
];

const pick = (methods: readonly string[]): ChainBinding[] =>
	methods.map((method) => {
		const binding = INPUT_TARGET.find((candidate) => candidate.method === method);
		if (binding === undefined) throw new Error(`no input-target binding for ${method}`);
		return binding;
	});

/** Every call-chain method per handle surface, in table order. Edit here, then run `bun run generate`. */
export const CHAIN_BINDINGS: Readonly<Record<Surface, readonly ChainBinding[]>> = {
	desktop: [
		{ method: "capabilities", source: "Computer.capabilities", generic: false },
		{ method: "displays", source: "Computer.displays", generic: true },
		{ method: "display", source: null, tier: "read", generic: false },
		{ method: "windows", source: "Computer.windows", generic: true },
		{ method: "window", source: "Computer.window", generic: false },
		{ method: "focusedWindow", source: null, tier: "read", generic: false },
		...pick(["screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse"]),
		{ method: "elementAt", source: null, tier: "read", generic: false },
		{ method: "focusedElement", source: null, tier: "read", generic: false },
		{ method: "ref", source: "Window.element", generic: false },
		{ method: "clipboard.read", source: null, tier: "read", generic: false },
		{ method: "clipboard.write", source: null, tier: "exec", generic: false },
		{ method: "control.acquire", source: "Control.acquire", generic: false },
		{ method: "control.release", source: "Control.release", generic: false },
		{ method: "control.state", source: "Control.state", generic: false },
	],
	display: pick(["screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse"]),
	window: [
		{ method: "screenshot", source: "Target.screenshot", generic: true },
		{ method: "observe", source: "Target.observe", generic: true },
		...pick(["zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse"]),
		{ method: "raise", source: "Window.raise", generic: true },
		{ method: "ax", source: "Target.ax", generic: true },
		{ method: "find", source: "Window.find", generic: false },
		{ method: "ref", source: "Window.element", generic: false },
		{ method: "menu.items", source: "Menus.items", generic: false },
		{ method: "menu.select", source: "Menus.select", generic: false },
	],
	element: [
		{ method: "value", source: "Element.read", generic: true },
		{ method: "setValue", source: "Element.setValue", generic: true },
		{ method: "bounds", source: "Element.read", generic: true },
		{ method: "attributes", source: "Element.attributes", generic: true },
		{ method: "actions", source: "Element.read", generic: true },
		{ method: "perform", source: "Element.perform", generic: true },
		{ method: "press", source: "Element.press", generic: true },
		{ method: "click", source: "Element.click", generic: true },
		{ method: "type", source: "Element.type", generic: true },
		{ method: "focus", source: "Element.focus", generic: true },
		{ method: "parent", source: "Element.read", generic: false },
		{ method: "children", source: "Element.read", generic: false },
	],
};

/** Kernel helpers composed from read calls in the facade itself; each needs a read-tier manifest source. */
export const COMPOSED_HELPERS: readonly ComposedHelper[] = [
	{ surface: "desktop", helper: "verify", source: "Computer.verify", reads: ["windows", "ref", "value", "attributes"] },
	{ surface: "window", helper: "drill", source: "Element.drill", reads: ["ax"] },
];

/** Tool actions of their own (`{ action }` without a chain); not call-chain methods. */
const ACTION_HELPERS: readonly string[] = ["run", "capabilities", "close"];

/** Manifest methods no kernel helper wraps, each with the reason; a new manifest method must land in one place. */
const KERNEL_OMITTED: Readonly<Record<string, string>> = {
	"Computer.batch": "kernels sequence steps with computer.run(fn)",
	"Computer.close": "the kernel close() is the tool's close action, which ends the host session",
	"ControlLease.release": "kernels release the grant with computer.control.release()",
	"StopPath.status": "the SDK event stream is for in-process callers; kernels see stops as errors",
	"StopPath.on": "the SDK event stream is for in-process callers; kernels see stops as errors",
	"Events.on": "the SDK event stream is for in-process callers; kernels see epochs as superseded/StaleRef errors",
};

export function readManifestCopy(): readonly ManifestEntry[] {
	const parsed = JSON.parse(readFileSync(MANIFEST_COPY_PATH, "utf8")) as { readonly methods?: unknown };
	if (!Array.isArray(parsed.methods)) throw new Error(`${MANIFEST_COPY_PATH} has no methods array`);
	return parsed.methods as readonly ManifestEntry[];
}

/** Each chain method's tier per surface, checked against the manifest: every manifest method lands somewhere. */
export function resolveTiers(manifest: readonly ManifestMethod[]): Record<Surface, [string, Tier, string][]> {
	const byName = new Map(manifest.map((entry) => [entry.method, entry] as const));
	const used = new Set<string>();
	const tierOf = (binding: ChainBinding, where: string): [Tier, string] => {
		if (binding.source === null) {
			if (binding.tier === undefined) throw new Error(`${where}: a binding without a manifest source needs a tier`);
			return [binding.tier, "kernel-only: no SDK facade method yet"];
		}
		if (binding.tier !== undefined) throw new Error(`${where}: the tier comes from ${binding.source}; drop it`);
		const entry = byName.get(binding.source);
		if (entry === undefined) throw new Error(`${where}: ${binding.source} is not in the facade manifest`);
		used.add(entry.method);
		return [entry.tier, entry.method];
	};
	const tables = {} as Record<Surface, [string, Tier, string][]>;
	for (const [surface, bindings] of Object.entries(CHAIN_BINDINGS) as [Surface, readonly ChainBinding[]][]) {
		const seen = new Set<string>();
		tables[surface] = bindings.map((binding) => {
			const where = `${surface}.${binding.method}`;
			if (seen.has(binding.method)) throw new Error(`${where}: bound twice`);
			seen.add(binding.method);
			const [tier, source] = tierOf(binding, where);
			return [binding.method, tier, source];
		});
	}
	for (const composed of COMPOSED_HELPERS) {
		const where = `${composed.surface}.${composed.helper}`;
		const entry = byName.get(composed.source);
		if (entry === undefined) throw new Error(`${where}: ${composed.source} is not in the facade manifest`);
		if (entry.tier !== "read") throw new Error(`${where}: a composed helper may only wrap a read-tier method`);
		for (const read of composed.reads) {
			const rows = Object.values(tables).flatMap((rows) => rows.filter(([method]) => method === read));
			if (rows.length === 0 || rows.some(([, tier]) => tier !== "read")) {
				throw new Error(`${where}: ${read} is not a read-tier chain method`);
			}
		}
		used.add(entry.method);
	}
	for (const entry of manifest) {
		const omitted = Object.hasOwn(KERNEL_OMITTED, entry.method);
		if (used.has(entry.method) && omitted) throw new Error(`${entry.method} is both bound and omitted`);
		if (!used.has(entry.method) && !omitted) {
			throw new Error(`${entry.method} has no kernel helper: bind it in CHAIN_BINDINGS or list it in KERNEL_OMITTED`);
		}
	}
	for (const name of Object.keys(KERNEL_OMITTED)) {
		if (!byName.has(name)) throw new Error(`KERNEL_OMITTED names ${name}, which is not in the facade manifest`);
	}
	return tables;
}

function chainMethodUnion(): string[] {
	return [...new Set(Object.values(CHAIN_BINDINGS).flatMap((bindings) => bindings.map((b) => b.method)))].sort();
}

function genericMethods(surface: Surface): string[] {
	return CHAIN_BINDINGS[surface].filter((binding) => binding.generic).map((binding) => binding.method);
}

const BEGIN = "<generated:facade>";
const END = "</generated:facade>";
const NOTE = "from facade-manifest.json by scripts/generate-assets.ts; edit CHAIN_BINDINGS there, then `bun run generate`";

function replaceRegion(text: string, path: string, body: string, comment: string, indent: string): string {
	const begin = text.indexOf(`${comment} ${BEGIN}`);
	const end = text.indexOf(`${comment} ${END}`);
	if (begin < 0 || end < begin) throw new Error(`${path}: missing the ${BEGIN} region`);
	const lineStart = text.lastIndexOf("\n", begin) + 1;
	return `${text.slice(0, lineStart)}${indent}${comment} ${BEGIN} ${NOTE}\n${body}${indent}${text.slice(end)}`;
}

const TABLE_DOCS: Readonly<Record<Surface, readonly [constName: string, doc: string]>> = {
	desktop: [
		"DESKTOP_METHODS",
		"Helpers callable on the `desktop` root; `window` and `ref` also anchor one-hop handle chains.",
	],
	display: ["DISPLAY_METHODS", "Helpers callable on a display handle resolved through `desktop.display(selector)`."],
	window: ["WINDOW_METHODS", "Helpers callable on a window handle resolved through `desktop.window(id)`."],
	element: ["ELEMENT_METHODS", "Helpers callable on an AX element handle resolved through `desktop.ref(ref)`."],
};

const tsKey = (name: string): string => (/^\w+$/.test(name) ? name : JSON.stringify(name));

function renderProtocolCall(current: string, tables: Record<Surface, [string, Tier, string][]>): string {
	const body = (Object.keys(TABLE_DOCS) as Surface[])
		.map((surface) => {
			const [constName, doc] = TABLE_DOCS[surface];
			const rows = tables[surface].map(([method, tier, source]) => `\t${tsKey(method)}: "${tier}", // ${source}\n`);
			return `/** ${doc} */\nexport const ${constName}: MethodPolicies = {\n${rows.join("")}};\n`;
		})
		.join("\n");
	return replaceRegion(current, protocolCallPath, body, "//", "");
}

function renderPreludeIndex(current: string): string {
	const rows = chainMethodUnion().map((method) => `\t"${method}",\n`);
	const body = `const METHOD_ALLOWLIST: readonly string[] = [\n${rows.join("")}];\n`;
	return replaceRegion(current, "src/index.ts", body, "//", "");
}

function renderProtocolAllowlistTest(current: string): string {
	const rows = chainMethodUnion().map((method) => `\t"${method}",\n`);
	const body = `const CHAIN_METHOD_SNAPSHOT = [\n${rows.join("")}];\n`;
	return replaceRegion(current, protocolAllowlistTestPath, body, "//", "");
}

function renderHelperNames(current: string): string {
	const list = (names: readonly string[]): string => `[${[...new Set(names)].sort().map((n) => JSON.stringify(n)).join(", ")}]`;
	const body =
		`export const CHAIN_METHODS: readonly string[] = ${list(chainMethodUnion())};\n` +
		`export const ACTION_HELPERS: readonly string[] = ${list(ACTION_HELPERS)};\n` +
		`export const COMPOSED_HELPERS: readonly string[] = ${list(COMPOSED_HELPERS.map((c) => c.helper))};\n`;
	return replaceRegion(current, helperNamesPath, body, "//", "");
}

const jsList = (methods: readonly string[]): string => `[${methods.map((method) => JSON.stringify(method)).join(", ")}]`;
const pyTuple = (methods: readonly string[]): string =>
	`(${methods.map((method) => JSON.stringify(method)).join(", ")}${methods.length === 1 ? "," : ""})`;

function renderPreludeJs(current: string): string {
	const body = (["desktop", "display", "window", "element"] as const)
		.map((surface) => `\tconst ${surface}ValueMethods = ${jsList(genericMethods(surface))};\n`)
		.join("");
	return replaceRegion(current, "src/prelude.js", body, "//", "\t");
}

function renderPreludePy(current: string): string {
	const body = (["desktop", "display", "window", "element"] as const)
		.map((surface) => `    _${surface.toUpperCase()}_METHODS = ${pyTuple(genericMethods(surface))}\n`)
		.join("");
	return replaceRegion(current, "src/prelude.py", body, "#", "    ");
}

/** The name each handle surface goes by in the docs and the guide. */
const HANDLE_NAMES: Readonly<Record<Surface, string>> = { desktop: "computer", display: "display", window: "win", element: "el" };

/** The docs line that heads the generated helper-tier block; the indented lines below it are rewritten. */
const HELPER_TIERS_HEADER = "Permission tier per helper (from the SDK facade manifest; a denied call throws):";

/** Rewrites the helper-tier block of docs/computer.md: one line per handle, its helpers split by tier. */
function renderDocumentation(current: string, tables: Record<Surface, [string, Tier, string][]>): string {
	const lines = current.split("\n");
	const start = lines.indexOf(HELPER_TIERS_HEADER);
	if (start < 0) throw new Error(`docs/computer.md: missing the line "${HELPER_TIERS_HEADER}"`);
	let end = start + 1;
	while (end < lines.length && lines[end]?.startsWith("    ")) end += 1;
	const body = (Object.keys(HANDLE_NAMES) as Surface[]).map((surface) => {
		const composed = COMPOSED_HELPERS.filter((helper) => helper.surface === surface);
		const rows: [string, Tier][] = [
			...tables[surface].map(([method, tier]): [string, Tier] => [method, tier]),
			...composed.map((helper): [string, Tier] => [helper.helper, "read"]),
		];
		const list = (tier: Tier): string => rows.filter(([, t]) => t === tier).map(([method]) => method).join(", ");
		const exec = list("exec");
		return `    ${HANDLE_NAMES[surface]}: read ${list("read")}${exec === "" ? "" : `; exec ${exec}`}`;
	});
	return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join("\n");
}

const returnType = (text: string): string => text.replace(/^Promise<(.*)>$/, "$1").replace(/\breadonly /g, "");

/**
 * The guide's method table: one row per facade-manifest method (signature, return, tier and policy) with the
 * kernel helpers that wrap it, `-` when only SDK callers reach it.
 */
function renderMethodTable(manifest: readonly ManifestEntry[]): string {
	const helpers = new Map<string, Map<string, Surface[]>>();
	const add = (source: string, helper: string, surface: Surface): void => {
		const bySurface = helpers.get(source) ?? new Map<string, Surface[]>();
		bySurface.set(helper, [...(bySurface.get(helper) ?? []), surface]);
		helpers.set(source, bySurface);
	};
	for (const [surface, bindings] of Object.entries(CHAIN_BINDINGS) as [Surface, readonly ChainBinding[]][]) {
		for (const binding of bindings) if (binding.source !== null) add(binding.source, binding.method, surface);
	}
	for (const composed of COMPOSED_HELPERS) add(composed.source, composed.helper, composed.surface);
	const rows = manifest.map((entry) => {
		const params = entry.params.map((param) => `${param.name}${param.optional ? "?" : ""}`).join(", ");
		const tier = entry.policy === "none" ? entry.tier : `${entry.tier}, ${entry.policy}`;
		// Helpers on the same handles as the one before them print as `.name` (`el.value, .bounds`).
		let previous = "";
		const kernel = [...(helpers.get(entry.method) ?? new Map<string, Surface[]>())]
			.map(([helper, surfaces]) => {
				const handles = surfaces.map((surface) => HANDLE_NAMES[surface]).join("/");
				const text = handles === previous ? `.${helper}` : `${handles}.${helper}`;
				previous = handles;
				return text;
			})
			.join(", ");
		return `| ${entry.method}(${params}) | ${returnType(entry.returns)} | ${tier} | ${kernel === "" ? "-" : kernel} |`;
	});
	return ["| SDK method | Returns | Tier, policy | Kernel helper |", "|---|---|---|---|", ...rows, ""].join("\n");
}

export function renderGeneratedSources(): Map<string, string> {
	const tables = resolveTiers(readManifestCopy());
	const read = (path: string): string => readFileSync(path, "utf8");
	const sources = new Map<string, string>();
	sources.set(protocolCallPath, renderProtocolCall(read(protocolCallPath), tables));
	const indexPath = join(packageDir, "src", "index.ts");
	sources.set(indexPath, renderPreludeIndex(read(indexPath)));
	const jsPath = join(packageDir, "src", "prelude.js");
	sources.set(jsPath, renderPreludeJs(read(jsPath)));
	const pyPath = join(packageDir, "src", "prelude.py");
	sources.set(pyPath, renderPreludePy(read(pyPath)));
	sources.set(protocolAllowlistTestPath, renderProtocolAllowlistTest(read(protocolAllowlistTestPath)));
	sources.set(helperNamesPath, renderHelperNames(read(helperNamesPath)));
	sources.set(documentationPath, renderDocumentation(read(documentationPath), tables));
	return sources;
}

export function renderAssetsJson(): string {
	const entries = Object.entries(ASSETS).map(([name, path]) => {
		return [name, readFileSync(join(packageDir, path), "utf8")] as const;
	});
	entries.push(["COMPUTER_METHOD_TABLE", renderMethodTable(readManifestCopy())]);
	return `${JSON.stringify(Object.fromEntries(entries), null, "\t")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const [path, content] of renderGeneratedSources()) writeFileSync(path, content);
	writeFileSync(ASSETS_JSON_PATH, renderAssetsJson());
}

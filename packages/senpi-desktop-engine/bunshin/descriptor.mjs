// The bunshin sidecar descriptor for the desktop engine, derived from the engine protocol schema so the ops, their
// effects, and their param schemas cannot drift from the engine. `--oneshot` bridges every op below; host-only and
// test-only engine methods are left out, except the two stop-path calls a mesh caller needs.
import { readFileSync } from "node:fs";

const SCHEMA_URL = new URL("../../../crates/senpi-desktop-core/schema/engine.schema.json", import.meta.url);

/** Mesh op -> engine method for the two stop-path exceptions the bridge forwards. */
const STOP_PATH_OPS = {
	"desktop.stop": "stopPath.stop",
	"desktop.stopPath.status": "stopPath.status",
};

const DEFAULT_STOP_CHORD = { darwin: "ctrl+opt+cmd+escape" };

/**
 * @param {{ executable: string, version: string, bunshinHome: string, platform?: NodeJS.Platform }} options
 */
/** The definitions `node` refers to, transitively, so each op's schema carries only what it needs. */
function reachableDefinitions(node, definitions) {
	const reached = {};
	const visit = (value) => {
		if (Array.isArray(value)) return value.forEach(visit);
		if (value === null || typeof value !== "object") return;
		const name = typeof value.$ref === "string" ? value.$ref.replace("#/definitions/", "") : undefined;
		if (name !== undefined && reached[name] === undefined && definitions[name] !== undefined) {
			reached[name] = definitions[name];
			visit(definitions[name]);
		}
		for (const child of Object.values(value)) visit(child);
	};
	visit(node);
	return reached;
}

export function desktopDescriptor({ executable, version, bunshinHome, platform = process.platform }) {
	const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
	const definitions = schema.definitions ?? {};
	const resolve = (params) => {
		const ref = params?.$ref?.replace("#/definitions/", "");
		if (ref === undefined) return params;
		const reached = reachableDefinitions(definitions[ref], definitions);
		return Object.keys(reached).length === 0 ? definitions[ref] : { ...definitions[ref], definitions: reached };
	};
	const ops = [];
	const effects = {};
	const schemas = {};
	for (const [method, spec] of Object.entries(schema.methods)) {
		if (spec.hostOnly || spec.testOnly || method.startsWith("$/") || method === "stopPath.stop") continue;
		const op = `desktop.${method}`;
		ops.push(op);
		effects[op] = spec.effect === "exec" ? "mutate" : "read";
		schemas[op] = resolve(spec.params);
	}
	for (const [op, method] of Object.entries(STOP_PATH_OPS)) {
		if (!ops.includes(op)) ops.push(op);
		effects[op] = "read";
		schemas[op] = op === "desktop.stop" ? { type: "object", properties: {}, additionalProperties: false } : resolve(schema.methods[method].params);
	}
	const stopChord = DEFAULT_STOP_CHORD[platform] ?? "ctrl+alt+shift+escape";
	return {
		name: "desktop",
		kind: "sidecar",
		version,
		description: "senpi desktop engine: screenshots, native input, accessibility, and the stop path",
		ops,
		effects,
		schemas,
		sidecar: {
			executable,
			args: ["--oneshot", "--audit-path", `${bunshinHome}/desktop-audit.jsonl`, "--stop-chord", stopChord],
			protocol: "json-rpc-stdio",
			timeoutMs: 65000,
		},
		sandbox: { grant: "full_access" },
	};
}

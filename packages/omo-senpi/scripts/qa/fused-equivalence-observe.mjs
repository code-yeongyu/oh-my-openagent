// EQ.omo observation (fused-equivalence-e2e.mjs): the senpi harness's collectors plus the plugin's own rules.
import { dropTimestampOffsets, splitStatusChannels } from "./fused-equivalence-support.mjs";
import { collectPluginState } from "./fused-equivalence-plugin-state.mjs";

/**
 * Id namespaces the plugin generates per run, by the key that carries them (plan §6.2: one-to-one first-occurrence token
 * maps per id namespace). The harness normalizer maps its own id keys; these are the plugin's: task ids are
 * time-derived, a memory identity and its binding hash are derived from the sandbox path, and a memory commit sha
 * hashes its date. A short sha (a 7+ character prefix of a mapped sha) maps to the same token with `:short`.
 */
const PLUGIN_ID_KEYS = {
	task_id: ["task", /^st_[0-9a-f]{8}$/],
	childId: ["task", /^st_[0-9a-f]{8}$/],
	identity: ["memory-identity", /^[a-z0-9-]+-[0-9a-f]{8}$/],
	repoPathHash: ["repo-path-hash", /^[0-9a-f]{64}$/],
	headSha: ["sha", /^[0-9a-f]{40}$/],
	sha: ["sha", /^[0-9a-f]{40}$/],
};

/** Literal roots for every plugin id the raw observations carry under a PLUGIN_ID_KEYS key, in first-occurrence order. */
function pluginIdRoots(raw) {
	const seen = new Map();
	const walk = (node, key) => {
		if (typeof node === "string") {
			const [namespace, shape] = (key !== undefined && Object.hasOwn(PLUGIN_ID_KEYS, key) && PLUGIN_ID_KEYS[key]) || [];
			if (namespace && shape.test(node) && !seen.has(node)) seen.set(node, namespace);
		} else if (Array.isArray(node)) node.forEach((item) => walk(item, key));
		else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, k);
	};
	walk(raw, undefined);
	const counters = new Map();
	const roots = [];
	for (const [value, namespace] of seen) {
		const index = (counters.get(namespace) ?? 0) + 1;
		counters.set(namespace, index);
		roots.push({ prefix: value, token: `<${namespace}:${index}>` });
		if (namespace === "sha")
			roots.push({ prefix: value.slice(0, 7), token: `<${namespace}:${index}:short>` });
	}
	return roots;
}

/**
 * A sub-agent's measured run time and the rate derived from it: durations, dropped like the harness drops its own. The
 * same rate is also rendered into the task's progress line (`\u00b7 333 tok/s`); there only the number is replaced.
 */
const PLUGIN_MEASUREMENT_KEYS = new Set(["runtime_ms", "tokens_per_second", "tokensPerSecond"]);
const RENDERED_RATE = /\b\d+(?:\.\d+)? tok\/s\b/g;

function dropMeasurements(node) {
	if (typeof node === "string") return node.replace(RENDERED_RATE, "<rate> tok/s");
	if (Array.isArray(node)) return node.map(dropMeasurements);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(
		Object.entries(node)
			.filter(([key]) => !PLUGIN_MEASUREMENT_KEYS.has(key))
			.map(([key, value]) => [key, dropMeasurements(value)]),
	);
}

/**
 * The harness's observe() (fused-equivalence/cases/support/observe.mjs) with the plugin's own rules added: O5 widened
 * to the plugin's durable state (fused-equivalence-plugin-state.mjs), the status channels split out, plugin
 * measurements dropped, the plugin id namespaces token-mapped, and a ranked timestamp's zone offset dropped with it.
 * The run-scoped roots and host facts are the harness's, unchanged.
 */
export function observeOmo(run, observables, harness) {
	const raw = Object.fromEntries(observables.map((id) => [id, dropMeasurements(harness.collectors[id](run))]));
	if (raw.O5) raw.O5 = { ...raw.O5, plugin: dropMeasurements(collectPluginState(run)) };
	if (raw.O6) raw.O6 = raw.O6.map(splitStatusChannels);
	const normalize = harness.createNormalizer({
		roots: [
			{ prefix: run.box.dir, token: "<sandbox>" },
			{ prefix: run.box.dir.replaceAll("/", "-"), token: "<sandbox-key>" },
			{ prefix: run.repo, token: "<repo>" },
			{ prefix: run.server.origin, token: "<model-server>" },
			{ prefix: run.server.origin.replace(/^http:\/\//, ""), token: "<model-server-host>" },
			...run.extraRoots,
			...pluginIdRoots(raw),
		],
		hostFacts: [...harness.hostFacts(), ...harness.childRuntimeFacts(run.childRuntime)],
	});
	return Object.fromEntries(observables.map((id) => [id, dropTimestampOffsets(normalize(raw[id]))]));
}

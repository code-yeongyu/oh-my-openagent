/**
 * Runtime migration: undo the installer-forced `enabled = true` on
 * `[features.multi_agent_v2]`.
 *
 * Whether V2 is active should be determined at runtime by the model's
 * server-side catalog entry (`ModelInfo.multi_agent_version`).  Previous
 * installer versions unconditionally set `enabled = true`, which forces
 * V2 for ALL models --- including those whose API does not support
 * encrypted tool parameters (spawn_agent).  This guard removes the
 * forced flag so the Codex runtime can make the right decision per model.
 */
export function disableMultiAgentV2IfForced(config) {
	const section = findMultiAgentV2Section(config);
	if (!section) return config;

	const enabledPattern = /^(\s*)enabled\s*=\s*true\s*$/m;
	if (!enabledPattern.test(section.text)) return config;

	const patched = section.text.replace(enabledPattern, "$1enabled = false");
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

function findMultiAgentV2Section(config) {
	const headerLine = "[features.multi_agent_v2]";
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let start = -1;
	for (const line of lines) {
		if (line.length === 0) break;
		const trimmed = line.trim();
		if (start === -1) {
			if (trimmed === headerLine) start = offset;
		} else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			return { start, end: offset, text: config.slice(start, offset) };
		}
		offset += line.length;
	}
	if (start === -1) return null;
	return { start, end: config.length, text: config.slice(start) };
}

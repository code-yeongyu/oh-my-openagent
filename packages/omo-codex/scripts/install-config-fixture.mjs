import assert from "node:assert/strict";

export function sectionText(config, header) {
	const start = config.indexOf(header);
	if (start === -1) return "";
	const afterStart = config.slice(start + header.length);
	const nextSectionOffset = afterStart.search(/\n\[/);
	return nextSectionOffset === -1
		? config.slice(start)
		: config.slice(start, start + header.length + nextSectionOffset);
}

export function multiAgentV2Section(config) {
	const header = "[features.multi_agent_v2]";
	const start = config.indexOf(header);
	assert.notEqual(start, -1);
	const rest = config.slice(start);
	const nextHeader = rest.slice(1).search(/^\[/m);
	return nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
}

import type { LoadedRule } from "./rules/types.js";
import type { TranscriptSearchOptions } from "./transcript-search.js";
import { readTranscriptSearchText } from "./transcript-search.js";

export function filterRulesAlreadyInTranscript(
	rules: ReadonlyArray<LoadedRule>,
	transcriptPath: string | null,
	markInjected: (rule: LoadedRule) => void,
	options: TranscriptSearchOptions = {},
): LoadedRule[] {
	if (rules.length === 0 || transcriptPath === null) {
		return [...rules];
	}

	const transcriptText = readTranscriptSearchText(transcriptPath, options);
	if (transcriptText === null) {
		return [...rules];
	}

	const pendingRules: LoadedRule[] = [];
	for (const rule of rules) {
		if (isRuleAlreadyInTranscript(rule, transcriptText)) {
			markInjected(rule);
			continue;
		}

		pendingRules.push(rule);
	}
	return pendingRules;
}

function isRuleAlreadyInTranscript(rule: LoadedRule, transcriptText: string): boolean {
	const bodyNeedle = rule.body.trim().slice(0, 2_000);
	if (bodyNeedle.length === 0 || !transcriptText.includes(bodyNeedle)) {
		return false;
	}

	const markers = [
		`Instructions from: ${rule.path}`,
		`Instructions from: ${rule.realPath}`,
		rule.relativePath.length === 0 ? null : rule.relativePath,
	].filter((marker): marker is string => marker !== null);
	return markers.some((marker) => transcriptText.includes(marker));
}

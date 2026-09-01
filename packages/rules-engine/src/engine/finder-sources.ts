import { UnsupportedRuleSourceError } from "./errors.js";
import type { RuleSource } from "./types.js";

export function toProjectRuleSource(parentDirectory: string, subDirectory: string): RuleSource {
	const source = `${parentDirectory}/${subDirectory}`;
	switch (source) {
		case ".omo/rules":
		case ".claude/rules":
		case ".cursor/rules":
		case ".github/instructions":
			return source;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported project rule source: ${source}`);
	}
}

export function toProjectSingleFileSource(ruleFile: string): RuleSource {
	switch (ruleFile) {
		case ".github/copilot-instructions.md":
		case "CONTEXT.md":
			return ruleFile;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported project single-file source: ${ruleFile}`);
	}
}

export function toUserHomeRuleSource(ruleSubdir: string): RuleSource {
	const source = `~/${ruleSubdir}`;
	switch (source) {
		case "~/.omo/rules":
		case "~/.opencode/rules":
		case "~/.claude/rules":
			return source;
		default:
			throw new UnsupportedRuleSourceError(`Unsupported user-home rule source: ${source}`);
	}
}

export function toUserHomeSingleFileSource(ruleFile: string): RuleSource {
	const source = `~/${ruleFile}`;
	switch (source) {
		default:
			throw new UnsupportedRuleSourceError(`Unsupported user-home single-file source: ${source}`);
	}
}

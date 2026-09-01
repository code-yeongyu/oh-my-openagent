import { isCandidateWithinProjectCached } from "./engine-paths.js";
import type { CandidateProjectMembership, EngineDeps, LoadedRuleContent } from "./engine-types.js";
import { hashContent } from "./matcher.js";
import { parseRule } from "./parser.js";
import type { LoadedRule, MatchReason, RuleCandidate, RuleDiagnostic } from "./types.js";

export function loadCandidate(
	candidate: RuleCandidate,
	deps: EngineDeps,
	diagnostics: RuleDiagnostic[],
	projectRoot: string | null,
	loadedRuleContent?: Map<string, LoadedRuleContent | null>,
	projectMembership?: CandidateProjectMembership,
): (LoadedRule & { matchReason: MatchReason }) | null {
	if (!isCandidateWithinProjectCached(candidate, projectRoot, projectMembership)) {
		diagnostics.push({
			severity: "warning",
			source: candidate.path,
			message: "Rule file resolves outside project root",
		});
		return null;
	}

	const cachedContent = loadedRuleContent?.get(candidate.realPath);
	if (cachedContent !== undefined) {
		return loadedRuleFromContent(candidate, cachedContent, diagnostics);
	}

	const content = deps.readFile(candidate.path);
	if (content === null) {
		loadedRuleContent?.set(candidate.realPath, null);
		diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
		return null;
	}

	const parsed = parseRule(content);
	const loadedContent = {
		frontmatter: parsed.frontmatter,
		body: parsed.body,
		contentHash: hashContent(content),
		...(parsed.diagnostic === undefined ? {} : { diagnostic: parsed.diagnostic }),
	} satisfies LoadedRuleContent;
	loadedRuleContent?.set(candidate.realPath, loadedContent);
	return loadedRuleFromContent(candidate, loadedContent, diagnostics);
}

export function ruleDedupKey(rule: LoadedRule): string {
	return `${rule.realPath}::${rule.contentHash}`;
}

export function staticMatchReason(rule: LoadedRule): MatchReason | null {
	if (rule.frontmatter.alwaysApply === true) {
		return "alwaysApply";
	}

	if (rule.isSingleFile) {
		return "single-file";
	}

	return null;
}

function loadedRuleFromContent(
	candidate: RuleCandidate,
	content: LoadedRuleContent | null,
	diagnostics: RuleDiagnostic[],
): (LoadedRule & { matchReason: MatchReason }) | null {
	if (content === null) {
		diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
		return null;
	}

	if (content.diagnostic !== undefined) {
		diagnostics.push({ severity: "warning", source: candidate.path, message: content.diagnostic });
	}

	return {
		...candidate,
		frontmatter: content.frontmatter,
		body: content.body,
		contentHash: content.contentHash,
		matchReason: { kind: "no-match" },
	};
}

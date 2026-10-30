import type { SourceHit, SourceRule } from "../../../rule"
import type { DetectConfig } from "../../../types"

export function checkSource(rule: SourceRule, text: string, options: { readonly path?: string; readonly config?: DetectConfig } = {}): readonly SourceHit[] {
	return rule.check({ file: { path: options.path ?? "fixture.tsx", text }, config: options.config ?? {} })
}

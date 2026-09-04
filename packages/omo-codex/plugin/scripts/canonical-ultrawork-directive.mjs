import { existsSync } from "node:fs";
import { join } from "node:path";

// Relative to BOTH the repo root and the plugin root. In a repo checkout the directive lives at
// <repo>/packages/prompts-core/prompts/ultrawork/codex.md. The Codex installer flattens the plugin
// directory into <CODEX_HOME>/plugins/cache/<marketplace>/<name>/<version>, where the repo-relative
// path dangles (it would resolve to plugins/cache/packages/...), so the installer materializes the
// same file at <pluginRoot>/packages/prompts-core/prompts/ultrawork/codex.md and sync-skills reads
// that copy instead. Keep the two segments lists in lockstep with
// packages/omo-codex/src/install/codex-cache-install.ts (copyCanonicalPromptSources).
export const canonicalUltraworkDirectiveRelativePath = join("packages", "prompts-core", "prompts", "ultrawork", "codex.md");

export function resolveCanonicalUltraworkDirectivePath(pluginRoot, repoRoot) {
	const checkoutPath = join(repoRoot, canonicalUltraworkDirectiveRelativePath);
	if (existsSync(checkoutPath)) return checkoutPath;
	return join(pluginRoot, canonicalUltraworkDirectiveRelativePath);
}

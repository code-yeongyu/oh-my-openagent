import { ULTRAWORK_DIRECTIVE_TEXT } from "./directive-content.js";

// Bundled at build time from packages/prompts-core/prompts/ultrawork/codex.md via
// scripts/sync-directive.mjs. prompts-core's contract is that markdown never gets read from disk
// at runtime, so the directive ships compiled into dist/cli.js instead of as a sibling .md read.
export const ULTRAWORK_DIRECTIVE: string = ULTRAWORK_DIRECTIVE_TEXT;

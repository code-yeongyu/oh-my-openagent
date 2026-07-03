// Codex-style "File operations" tuning block, shared by every GPT-5.x preset.
//
// This is the senpi equivalent of codex-rs/core/gpt_5_2_prompt.md's Task
// execution + Shell commands + apply_patch sections, collapsed into a single
// paragraph. It exists because GPT models have a strong pre-training prior
// toward "use python/sed/heredoc to manipulate files", which the function-call
// schema alone is too weak to override - codex itself learned this and added an
// explicit "Do not use python scripts to attempt to output larger chunks of a
// file" line by GPT-5.1.
//
// Wording rules:
// - Positive routing first ("use X"), negative guard second ("do not Y").
//   Negative-only directives compete with priors and lose; positive routing
//   gives the model the verb to reach for.
// - Mention `apply_patch`, `read`, the `grep` tool, and forbid python/sed/awk
//   heredoc-driven shell mutations explicitly. The `grep` tool note prevents
//   the model from invoking `grep`/`rg` through bash when senpi exposes a
//   ripgrep-backed `grep` tool already.
// - Mirror codex's "do not waste tokens re-reading after apply_patch" guard.
export function buildFileOperationsTuning(): string {
	return `## File operations

Use \`apply_patch\` for ALL file edits and creations. Do NOT write or modify files via bash heredoc (\`cat >\`, \`echo > \`), \`sed -i\`, \`awk -i\`, or inline \`python\`/\`python3 -c\` scripts.

Use \`read\` for ALL file inspection. Do NOT substitute \`cat\`, \`sed\`, \`head\`, \`tail\`, or inline \`python\` invoked through bash.

For text or filename search, use the \`grep\` tool (ripgrep-backed, respects .gitignore). Do NOT shell out to \`grep\` or \`rg\` through bash for the same purpose.

Do not re-read a file immediately after a successful \`apply_patch\`; the call returns failure directly if the patch did not apply.`;
}

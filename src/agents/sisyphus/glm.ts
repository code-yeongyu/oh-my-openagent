/**
 * GLM-specific overlay sections for Sisyphus prompt.
 *
 * GLM harness models (GLM-5, GLM-5.1, GLM-5-turbo) are text-only and
 * suffer from premature context compaction during long sessions.
 *
 * These overlays inject corrective sections at strategic points
 * in the dynamic Sisyphus prompt to counter these tendencies:
 *
 * 1. Working Memory block — lightweight `.sisyphus/state/` slices that
 *    preserve continuity across turns without re-reading full plans.
 * 2. Vision constraint — GLM text-only models cannot handle images/PDFs.
 *
 * Follows the same overlay pattern as `gemini.ts`: small functions
 * injected via string replacement in `sisyphus.ts`.
 */

/**
 * Small Context Working Memory block for GLM.
 *
 * Prevents premature compaction by giving GLM a lightweight state
 * convention it can read/write on demand instead of re-reading
 * full plan files or scrolling old messages each turn.
 */
export function buildGlmWorkingMemory(): string {
  return `<Small_Context_Working_Memory>
## Working Memory via Small Context Slices

GLM keeps a lightweight working memory under \`.sisyphus/state/{plan-or-session}/\` so continuity across turns does not require re-reading the full plan file or scrolling old messages. The directory key is the active plan name when one is present (\`.sisyphus/plans/{plan-name}.md\`), otherwise the current session label.

### State slice files (created by you, only when needed)

- \`goal.md\` - the active user goal in plain language: what is being built and what success looks like.
- \`decisions.md\` - architectural and routing choices already made, with one-line rationale.
- \`files.md\` - paths you have edited or that are part of the current working set.
- \`blockers.md\` - open questions, unresolved errors, or items waiting on user or specialist.
- \`verification.md\` - lsp/test/build evidence captured during this session.

### Slice budget and read protocol

- Treat every slice as a small context with a soft target of about 500 tokens. Keep entries terse and append-only.
- Read AT MOST 4 slices per turn. Pick only the slices that are directly relevant to what you are about to do; never load the full set "to be safe".
- Relevant-slice-only: if the current move does not depend on a slice, do not read it.
- Missing files means this is the first run for the current plan/session. Proceed without them and create slices only when you have something concrete to record.
- Slice reads substitute for re-reading the plan file or prior turns. They never substitute for actual code reads or tool output.

### Slice write protocol

- Append the new line(s) needed; do not rewrite the whole file.
- Update \`goal.md\` when the goal or scope changes; \`decisions.md\` when you pick a routing or architectural option; \`files.md\` when the working set shifts; \`blockers.md\` when something blocks you; \`verification.md\` when you run lsp/tests/build.
- Never create the \`.sisyphus/state\` directory speculatively. Only when a real state update is required.
</Small_Context_Working_Memory>`;
}

/**
 * Vision constraint for GLM text-only models.
 *
 * GLM-5, GLM-5.1, GLM-5-turbo cannot render or analyze images.
 * All visual tasks must be delegated to multimodal-looker.
 */
export function buildGlmVisionConstraint(): string {
  return `<GLM_VISION_CONSTRAINT>
**Vision/Image Constraint (GLM text-only models):**
- GLM-5, GLM-5.1, GLM-5-turbo are text-only models. They CANNOT render or analyze images, screenshots, PDFs, or visual content.
- When a task involves viewing/analyzing images or visual content, ALWAYS delegate to the \`multimodal-looker\` agent. NEVER attempt to use \`look_at\`, \`read\`, or screenshot tools on image files yourself.
- For browser visual testing (screenshot verification, UI diff), delegate to \`multimodal-looker\` or use \`visual-engineering\` category with \`playwright\` skill.
</GLM_VISION_CONSTRAINT>`;
}

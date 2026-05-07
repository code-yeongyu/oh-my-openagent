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

export function buildGlmVisionConstraint(): string {
  return `<GLM_VISION_CONSTRAINT>
**Vision/Image Constraint (GLM text-only models):**
- GLM-5, GLM-5.1, GLM-5-turbo are text-only models. They CANNOT render or analyze images, screenshots, PDFs, or visual content.
- When a task involves viewing/analyzing images or visual content, ALWAYS delegate to the \`multimodal-looker\` agent. NEVER attempt to use \`look_at\`, \`read\`, or screenshot tools on image files yourself.
- For browser visual testing (screenshot verification, UI diff), delegate to \`multimodal-looker\` or use \`visual-engineering\` category with \`playwright\` skill.
</GLM_VISION_CONSTRAINT>`;
}

export function buildGlmVisionHardBlock(): string {
  return `## GLM Vision Constraint (HARD BLOCK)

You are a TEXT-ONLY model. You CANNOT see images.

NEVER call these tools yourself for images/screenshots/PDFs:
- \`look_at\`
- \`read\` (on image/PDF/binary files)
- \`brave-devtools_take_screenshot\`
- \`playwright_browser_take_screenshot\`
- \`figma_get_screenshot\`

When user shares an image, screenshot, or asks to analyze visual content:
1. Delegate to \`multimodal-looker\` agent.
2. If \`zai-mcp-server_*\` tools are available, you may use them as a secondary option.

Do not inspect visual content directly.`;
}

export function buildGlmSubagentVisionBlock(): string {
  return `

## GLM Vision Constraint (HARD BLOCK)
You are a TEXT-ONLY model. You CANNOT see images.
Never call look_at, read (on image files), or screenshot tools. Delegate to multimodal-looker; if zai-mcp-server tools are available, they may be used as a secondary option.
`;
}

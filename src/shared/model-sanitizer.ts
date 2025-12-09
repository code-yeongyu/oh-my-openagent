/**
 * Sanitizes model field from frontmatter.
 * Always returns undefined to let SDK use default model.
 *
 * Claude Code and OpenCode use different model ID formats,
 * so we ignore the model field and let OpenCode use its configured default.
 *
 * @param _model - Raw model value from frontmatter (ignored)
 * @returns Always undefined to inherit default model
 */
export function sanitizeModelField(_model: unknown): undefined {
  return undefined
}

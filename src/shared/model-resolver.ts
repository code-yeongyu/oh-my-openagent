/**
 * Input for model resolution.
 * All model strings are optional except systemDefault which is the terminal fallback.
 */
export type ModelResolutionInput = {
  /** Model from user category config */
  userModel?: string;
  /** Model inherited from parent task/session */
  inheritedModel?: string;
  /** System default model from OpenCode config - always required */
  systemDefault: string;
};

/**
 * Normalizes a model string.
 * Trims whitespace and treats empty/whitespace-only as undefined.
 */
function normalizeModel(model?: string): string | undefined {
  const trimmed = model?.trim();
  return trimmed || undefined;
}

/**
 * Resolves the effective model using priority chain:
 * userModel → inheritedModel → systemDefault
 *
 * Empty strings and whitespace-only strings are treated as unset.
 */
export function resolveModel(input: ModelResolutionInput): string {
  return (
    normalizeModel(input.userModel) ??
    normalizeModel(input.inheritedModel) ??
    input.systemDefault
  );
}

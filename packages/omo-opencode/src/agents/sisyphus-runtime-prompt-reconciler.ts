import { resolveSisyphusPromptFamily } from "./sisyphus-agent-factory";

/**
 * Context captured at Sisyphus registration so the per-request system-transform
 * hook can rebuild the prompt for the model actually selected at runtime.
 *
 * - `bakedPrompt` is the exact prompt string registered (body + overrides + env),
 *   used to locate the entry to replace in the runtime system array.
 * - `rebuildPromptForModel` re-runs the same registration pipeline with a
 *   different model, so overrides / prompt_append / env context are preserved.
 */
export type SisyphusRuntimePromptContext = {
  configuredModel: string;
  bakedPrompt: string;
  rebuildPromptForModel: (runtimeModel: string) => string;
};

let context: SisyphusRuntimePromptContext | undefined;

export function setSisyphusRuntimePromptContext(ctx: SisyphusRuntimePromptContext): void {
  context = ctx;
}

export function clearSisyphusRuntimePromptContext(): void {
  context = undefined;
}

/**
 * The Sisyphus prompt body is baked at registration from the *configured* model
 * in `oh-my-openagent.jsonc`. When the user switches to a different model family
 * in the TUI, the entire baked body is the wrong family for the runtime model
 * (issue #5297/#5316): a GPT-configured agent run on a non-GPT model still
 * carries the whole GPT-5.5 body, not just one apply_patch line.
 *
 * The system-transform hook is the only per-request seam that knows the runtime
 * model, so rebuild the whole prompt for the runtime family and swap it in here
 * rather than patching individual family-specific lines (which can never convert
 * a GPT body into a non-GPT one).
 *
 * Returns true if a swap was performed.
 */
export function reconcileSisyphusRuntimePrompt(
  system: string[],
  runtimeModel: string | undefined,
): boolean {
  if (!runtimeModel || !context) return false

  // Same family => the baked body already matches the runtime model; leave it.
  if (
    resolveSisyphusPromptFamily(runtimeModel) ===
    resolveSisyphusPromptFamily(context.configuredModel)
  ) {
    return false
  }

  const rebuilt = context.rebuildPromptForModel(runtimeModel)
  if (rebuilt === context.bakedPrompt) return false

  // Substring replace rather than exact-equality: opencode core may concatenate
  // the agent prompt with other system text in a single array entry, so match
  // the baked body wherever it appears.
  let swapped = false
  for (let i = 0; i < system.length; i++) {
    const part = system[i]
    if (part.includes(context.bakedPrompt)) {
      system[i] = part.split(context.bakedPrompt).join(rebuilt)
      swapped = true
    }
  }
  return swapped
}

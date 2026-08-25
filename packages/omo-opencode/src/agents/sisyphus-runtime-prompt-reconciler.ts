/**
 * Context captured at Sisyphus registration so the per-request system-transform
 * hook can rebuild the prompt for the model actually selected at runtime.
 *
 * - `configuredModel` is the exact model `bakedPrompt` was built for. It is the
 *   "last built model": the prompt is baked only at registration, and opencode
 *   re-assembles the system array from the agent config on every request, so
 *   nothing else can become the currently baked prompt mid-session.
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
 * in `.omo/omo.jsonc`. When the user switches to a different model in
 * the TUI, the baked body may be wrong for the runtime model
 * (issue #5297/#5316): a GPT-configured agent run on a non-GPT model still
 * carries the whole GPT-5.5 body, not just one apply_patch line.
 *
 * The system-transform hook is the only per-request seam that knows the runtime
 * model, so rebuild the whole prompt for the runtime model and swap it in here
 * rather than patching individual model-specific lines (which can never convert
 * a GPT body into a non-GPT one).
 *
 * The skip must key on the exact model, not the broad prompt family: the
 * `fallback` family is not prompt-uniform (Gemini fallback overrides, GPT
 * identity text, claude/non-claude sections), so a same-family switch such as
 * Gemini -> MiniMax-M3 or DeepSeek -> MiniMax-M3 can still leave the previous
 * model's body in place (issue #6966). Genuine no-op switches (models whose
 * rebuilt prompt is byte-identical to the baked one) are suppressed below.
 *
 * Returns true if a swap was performed.
 */
export function reconcileSisyphusRuntimePrompt(
  system: string[],
  runtimeModel: string | undefined,
): boolean {
  if (!runtimeModel || !context) return false

  // Same exact model => the baked body already matches the runtime model; leave it.
  if (runtimeModel === context.configuredModel) {
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

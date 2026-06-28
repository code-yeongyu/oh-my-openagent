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

// Per-session cache: avoid calling rebuildPromptForModel on every turn when the
// runtime model is stable. The cache is keyed by the exact runtimeModel string
// and is cleared together with `context` at session end.
let lastReconciledModel: string | undefined;
let cachedRebuiltPrompt: string | undefined;

export function setSisyphusRuntimePromptContext(ctx: SisyphusRuntimePromptContext): void {
  context = ctx;
}

export function clearSisyphusRuntimePromptContext(): void {
  context = undefined;
  lastReconciledModel = undefined;
  cachedRebuiltPrompt = undefined;
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
 * Rebuilding is expensive and non-deterministic across calls (it reads live env
 * and config state), so the result is cached per runtime-model string. The cache
 * is invalidated when the runtime model changes or the session context is cleared
 * (fix for #5578: reconciler was rebuilding on every turn causing behavioural
 * non-determinism within a single session).
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

  // Use the cached rebuilt prompt when the runtime model has not changed since
  // the last reconciliation. rebuildPromptForModel reads live env/config state
  // and is therefore not guaranteed to be pure; calling it on every turn can
  // produce subtly different prompts even with the same model id (#5578).
  let rebuilt: string;
  if (runtimeModel === lastReconciledModel && cachedRebuiltPrompt !== undefined) {
    rebuilt = cachedRebuiltPrompt;
  } else {
    rebuilt = context.rebuildPromptForModel(runtimeModel);
    lastReconciledModel = runtimeModel;
    cachedRebuiltPrompt = rebuilt;
  }

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

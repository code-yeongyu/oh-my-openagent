/**
 * A frozen copy of the pinned engine's DEFAULT_FALLBACK_CHAINS (core/retry-fallback/settings), keyed by bare model id;
 * settings chains layer over it per key. It follows the engine pin, not the latest-model table, and
 * `engine-defaults.parity.test.ts` holds it equal to the pinned engine's own SettingsManager.
 */
export const ENGINE_DEFAULT_FALLBACK_CHAINS: Readonly<Record<string, readonly string[]>> = {
  "claude-fable-5-2": ["claude-opus-5-5", "claude-opus-5"],
  "claude-fable-5-1": ["claude-opus-5-5", "claude-opus-5"],
  "claude-fable-5": ["claude-opus-5-5", "claude-opus-5"],
  "claude-opus-5-5": ["claude-fable-5-2:medium", "kimi-k3.1-pro:max"],
}

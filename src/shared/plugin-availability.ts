/**
 * Plugin Availability Checker & Warning Utilities
 *
 * Detects when antigravity models are used without the required plugin,
 * and provides helpful deprecation warnings to users.
 */

/**
 * Check if a module is installed in the current environment.
 * @param moduleName - The name of the module to check (e.g., 'opencode-antigravity-auth')
 * @returns true if the module is installed, false otherwise
 */
export function isModuleInstalled(moduleName: string): boolean {
  try {
    require.resolve(moduleName)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a model ID uses the antigravity namespace.
 * @param modelID - The model ID to check (e.g., 'google/antigravity-gemini-3-1-pro')
 * @returns true if the model uses antigravity prefix
 */
export function isAntigravityModel(modelID: string): boolean {
  return modelID.toLowerCase().includes("antigravity")
}

/**
 * Check if the required antigravity plugin is installed.
 * @returns true if opencode-antigravity-auth is installed, false otherwise
 */
export function isAntigravityPluginInstalled(): boolean {
  return isModuleInstalled("opencode-antigravity-auth")
}

/**
 * Log a warning if antigravity models are used without the plugin.
 * Intended to be called during model resolution for user-facing operations.
 *
 * @param modelID - The model ID being used
 * @param context - Optional context string (e.g., 'agent: Sisyphus')
 */
export function warnAntigravityPluginMissing(modelID: string, context?: string): void {
  if (!isAntigravityModel(modelID)) {
    return
  }

  if (isAntigravityPluginInstalled()) {
    return
  }

  const contextStr = context ? ` [${context}]` : ""
  const contextInfo = context ? `\n   Context: ${context}` : ""

  console.warn(
    `⚠️  Antigravity model detected but plugin not installed${contextStr}\n` +
    `   Model: ${modelID}\n` +
    `${contextInfo}\n` +
    `   The 'opencode-antigravity-auth' plugin is required to use this model.\n` +
    `   Install with:\n` +
    `     npm install opencode-antigravity-auth\n` +
    `\n` +
    `   Documentation: https://github.com/NoeFabris/opencode-antigravity-auth\n` +
    `   oh-my-openagent guide: docs/reference/configuration.md#google-auth-via-antigravity-optional`
  )
}

/**
 * Validate that antigravity models have required plugin.
 * Throws an error if plugin is missing (for critical operations).
 *
 * @param modelID - The model ID to validate
 * @param context - Optional context string for error message
 * @throws {Error} if model is antigravity but plugin is not installed
 */
export function validateAntigravityPlugin(modelID: string, context?: string): void {
  if (!isAntigravityModel(modelID)) {
    return
  }

  if (!isAntigravityPluginInstalled()) {
    const contextStr = context ? ` (${context})` : ""
    throw new Error(
      `Cannot use antigravity model '${modelID}' without 'opencode-antigravity-auth' plugin${contextStr}. ` +
      `Install with: npm install opencode-antigravity-auth`
    )
  }
}

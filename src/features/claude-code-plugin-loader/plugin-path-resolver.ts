// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional string constant for template matching
const CLAUDE_PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"

function resolvePluginPath(path: string, pluginRoot: string): string {
  return path.replace(CLAUDE_PLUGIN_ROOT_VAR, pluginRoot)
}

export function resolvePluginPaths<T>(obj: T, pluginRoot: string): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return resolvePluginPath(obj, pluginRoot) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolvePluginPaths(item, pluginRoot)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolvePluginPaths(value, pluginRoot)
    }
    return result as T
  }
  return obj
}

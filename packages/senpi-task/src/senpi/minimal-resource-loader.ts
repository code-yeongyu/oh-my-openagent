import type {
  ExtensionRuntime,
  LoadExtensionsResult,
  ResourceLoader,
} from "@code-yeongyu/senpi"

export type MinimalSenpiResourceLoaderOptions = {
  readonly runtime: ExtensionRuntime
  /**
   * System prompt that REPLACES senpi's default dynamic system prompt. Absent keeps the default
   * (undefined): a loader without this field behaves exactly as before, so the child builds the
   * engine's own prompt. A present value is returned verbatim from getSystemPrompt(); senpi's
   * session construction uses the loader's prompt INSTEAD of buildDynamicSystemPrompt().
   */
  readonly systemPrompt?: string
}

export function createMinimalSenpiResourceLoader(options: MinimalSenpiResourceLoaderOptions): ResourceLoader {
  const extensionsResult: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: options.runtime,
  }

  return {
    getExtensions() {
      return extensionsResult
    },
    getSkills() {
      return { skills: [], diagnostics: [] }
    },
    getPrompts() {
      return { prompts: [], diagnostics: [] }
    },
    getThemes() {
      return { themes: [], diagnostics: [] }
    },
    getAgentsFiles() {
      return { agentsFiles: [] }
    },
    getSystemPrompt() {
      return options.systemPrompt
    },
    getSystemPromptSource() {
      return undefined
    },
    getAppendSystemPrompt() {
      return []
    },
    getAppendSystemPromptSources() {
      return []
    },
    extendResources() {},
    async reload() {},
  }
}

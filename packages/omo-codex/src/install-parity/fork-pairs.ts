export type ParityMode = "byte-output" | "pure-output" | "surface-only"

export type ForkPair = {
  readonly id: string
  readonly family: string
  readonly tsPath: string
  readonly mjsPath: string
  readonly mode: ParityMode
  readonly coveredBy: readonly string[]
  readonly exports: readonly string[]
  readonly note?: string
}

export const forkPairs = [
  {
    id: "agents-linking",
    family: "agents",
    tsPath: "packages/omo-opencode/src/cli/install-codex/link-cached-plugin-agents.ts",
    mjsPath: "packages/omo-codex/scripts/install/agents.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["linkCachedPluginAgents", "capturePreservedAgentReasoning", "capturePreservedAgentServiceTier"],
  },
  {
    id: "agents-source-roots",
    family: "agents",
    tsPath: "packages/omo-opencode/src/cli/install-codex/install-codex.ts",
    mjsPath: "packages/omo-codex/scripts/install/agent-source-roots.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["agentSourceRootsForInstall"],
    note: "The TS helper is intentionally local to the installer orchestrator until the source move.",
  },
  {
    id: "bin-links",
    family: "bin-links",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-cache-bins.ts",
    mjsPath: "packages/omo-codex/scripts/install/bin-links.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["linkCachedPluginBins", "linkRootRuntimeBin"],
  },
  {
    id: "git-bash",
    family: "git-bash",
    tsPath: "packages/omo-opencode/src/cli/install-codex/git-bash.ts",
    mjsPath: "packages/omo-codex/scripts/install/git-bash.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["resolveGitBash", "resolveGitBashForCurrentProcess", "prepareGitBashForInstall"],
    note: "The mjs side includes checkedPaths in successful results and filters known Windows launcher paths.",
  },
  {
    id: "marketplace",
    family: "marketplace",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-marketplace.ts",
    mjsPath: "packages/omo-codex/scripts/install/marketplace.mjs",
    mode: "pure-output",
    coveredBy: ["install-parity-inventory", "install-function-parity"],
    exports: ["readMarketplace", "resolvePluginSource", "readPluginManifest", "validatePathSegment"],
    note: "readPluginManifest currently has an intentional hooks field surface difference.",
  },
  {
    id: "model-catalog",
    family: "model-catalog",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-model-catalog.ts",
    mjsPath: "packages/omo-codex/scripts/install/model-catalog.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["readCodexModelCatalog", "readCodexReasoningProfile"],
  },
  {
    id: "reasoning-config",
    family: "model-catalog",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-config-reasoning.ts",
    mjsPath: "packages/omo-codex/scripts/install/reasoning-config.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["ensureCodexReasoningConfig"],
  },
  {
    id: "project-local-cleanup",
    family: "project-local-cleanup",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-project-local-cleanup.ts",
    mjsPath: "packages/omo-codex/scripts/install/project-local-cleanup.mjs",
    mode: "pure-output",
    coveredBy: ["install-parity-inventory", "install-function-parity"],
    exports: ["repairNearestProjectLocalCodexArtifacts", "emptyProjectLocalCodexCleanupResult", "repairProjectLocalCodexConfigText"],
  },
  {
    id: "snapshot",
    family: "snapshot",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-marketplace-snapshot.ts",
    mjsPath: "packages/omo-codex/scripts/install/snapshot.mjs",
    mode: "pure-output",
    coveredBy: ["install-parity-inventory", "install-function-parity"],
    exports: ["writeInstalledMarketplaceSnapshot", "installedMarketplaceRoot"],
    note: "The TS snapshot additionally copies bundled MCP runtime dist files.",
  },
  {
    id: "cached-marketplace-manifest",
    family: "snapshot",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-cached-marketplace-manifest.ts",
    mjsPath: "packages/omo-codex/scripts/install/cached-marketplace-manifest.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["writeCachedMarketplaceManifest"],
  },
  {
    id: "lazycodex-version-stamp",
    family: "lazycodex-version-stamp",
    tsPath: "packages/omo-opencode/src/cli/install-codex/lazycodex-version-stamp.ts",
    mjsPath: "packages/omo-codex/scripts/install/lazycodex-version-stamp.mjs",
    mode: "pure-output",
    coveredBy: ["install-parity-inventory", "install-function-parity"],
    exports: ["readDistributionManifest", "resolveLazyCodexPluginVersion", "stampLazyCodexPluginVersion", "writeLazyCodexInstallSnapshot"],
  },
  {
    id: "toml-editor",
    family: "toml",
    tsPath: "packages/omo-opencode/src/cli/install-codex/toml-section-editor.ts",
    mjsPath: "packages/omo-codex/scripts/install/toml-editor.mjs",
    mode: "byte-output",
    coveredBy: ["install-parity-inventory", "install-toml-parity"],
    exports: ["findTomlSection", "replaceOrInsertSetting", "removeSetting", "replaceOrInsertRootSetting", "appendBlock", "escapeRegExp"],
  },
  {
    id: "cache-install",
    family: "cache",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-cache.ts",
    mjsPath: "packages/omo-codex/scripts/install/cache.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["installCachedPlugin", "linkCachedPluginBins", "linkRootRuntimeBin", "pruneMarketplaceCache", "rewriteCachedMcpManifest"],
  },
  {
    id: "cache-runtime-path",
    family: "cache",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-cache-paths.ts",
    mjsPath: "packages/omo-codex/scripts/install/mcp-runtime-cache.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["resolveCachedRuntimePath"],
    note: "The mjs side owns dist-copy caching; the TS side exposes only the path fallback primitive.",
  },
  {
    id: "bin-dir",
    family: "bin-dir",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-installer-bin-dir.ts",
    mjsPath: "packages/omo-codex/scripts/install/bin-dir.mjs",
    mode: "pure-output",
    coveredBy: ["install-parity-inventory", "install-function-parity"],
    exports: ["resolveCodexInstallerBinDir"],
    note: "bin-dir.mjs exports nonEmptyEnvValue and accepts env defaults; TS also accepts an explicit binDir option.",
  },
  {
    id: "process",
    family: "process",
    tsPath: "packages/omo-opencode/src/cli/install-codex/codex-process.ts",
    mjsPath: "packages/omo-codex/scripts/install/process.mjs",
    mode: "surface-only",
    coveredBy: ["install-parity-inventory"],
    exports: ["defaultRunCommand"],
    note: "codex-process.ts exports resolveRunCommandInvocation; process.mjs delegates that normalization to plugin/scripts/spawn-command.mjs.",
  },
] as const satisfies readonly ForkPair[]

export const parityCoverageTags = [
  "install-parity-inventory",
  "install-toml-parity",
  "install-function-parity",
] as const

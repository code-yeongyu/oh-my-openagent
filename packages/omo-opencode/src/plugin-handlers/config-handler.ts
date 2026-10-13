import type { OhMyOpenCodeConfig } from "../config";
import { applyRuntimeSkillSourceConfig } from "../features/opencode-runtime-skills"
import { setAdditionalAllowedMcpEnvVars } from "../features/claude-code-mcp-loader";
import { applyOpenGatewayProviderConfig } from "../features/opengateway-provider";
import type { ModelCacheState } from "../plugin-state";
import { log } from "../shared";
import {
  type FingerprintMemo,
  fingerprintAncestorSources,
  fingerprintFileReferences,
  fingerprintGlobalSources,
  fingerprintProjectSources,
  getProcessAgentSnapshotMap,
  getProcessConfigCacheEntry,
  rememberAgentSnapshot,
  stableDigest,
} from "../shared/process-config-cache";
import { AGENT_DISPLAY_NAMES, getAgentListDisplayName } from "../shared/agent-display-names";
import { applyAgentConfig } from "./agent-config-handler";
import { applyCommandConfig } from "./command-config-handler";
import { applyHookConfig } from "./hook-config-handler";
import { applyMcpConfig } from "./mcp-config-handler";
import { applyProviderConfig } from "./provider-config-handler";
import { loadPluginComponents } from "./plugin-components-loader";
import { applyToolConfig } from "./tool-config-handler";
import { clearFormatterCache } from "../tools/hashline-edit/formatter-trigger"
import {
  clearRegisteredAgentNames,
  registerAgentName,
} from "../features/claude-code-session-state";
import { setDefaultAgentForSort } from "../shared/agent-sort-shim";
import { getConfiguredDefaultAgent } from "./agent-config-assembly";
import { openCodeShellTypeResolver } from "../shared/opencode-shell"

export { resolveCategoryConfig } from "./category-config-resolver";

function collectTrustedVisionCapableModels(
  pluginConfig: OhMyOpenCodeConfig,
): string[] {
  const trusted: string[] = []
  const multimodalLookerOverride = pluginConfig.agents?.["multimodal-looker"]
  const configuredModel = multimodalLookerOverride?.model
  if (typeof configuredModel === "string" && configuredModel.includes("/")) {
    trusted.push(configuredModel)
  }
  return trusted
}

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: unknown };
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  runtimeSkillSourceUrl?: string;
}

type AgentConfigSnapshot = {
  readonly cacheKey: string;
  readonly configuredDefaultAgent: string | undefined;
  readonly defaultAgent: unknown;
  readonly agents: Record<string, unknown>;
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneConfigValue)
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]),
    )
  }

  return value
}

function cloneAgentConfig(agents: Record<string, unknown>): Record<string, unknown> {
  return cloneConfigValue(agents) as Record<string, unknown>
}

function createAgentConfigCacheKey(config: Record<string, unknown>): string {
  return JSON.stringify({
    agent: config.agent,
    default_agent: config.default_agent,
    model: config.model,
    skills: config.skills,
  })
}

/**
 * Cross-folder agent-config snapshot key (local fix 28, first-message-drop
 * F5c; made complete by local fix 31). The snapshot used to live in the
 * per-instance closure, so every folder rebuild re-ran applyAgentConfig (the
 * largest identified cold-start owner: 11.7s of a 17.7s cold plugin setup).
 *
 * The key covers every input applyAgentConfig reads: the OpenCode config
 * slice, the effective OMO config, the loaded plugin components, the user-level
 * source directories, the folder's own project sources, the sources its
 * ancestors contribute, and the targets of file:// prompt references. Folders
 * for which all of that is identical (sibling OpenChamber chat folders are
 * empty directories under one parent) share a snapshot; anything else gets its
 * own. Returns undefined when a source tree is too large to fingerprint: such
 * a folder is never served from the process cache.
 */
function createEffectiveAgentSnapshotKey(params: {
  agentCacheKey: string;
  directory: string;
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: { agents: unknown; plugins: unknown };
  globalSourcesFingerprint: string | undefined;
  memo: FingerprintMemo;
}): string | undefined {
  if (params.globalSourcesFingerprint === undefined) return undefined
  const project = fingerprintProjectSources(params.directory, params.memo)
  if (project === undefined) return undefined
  const ancestors = fingerprintAncestorSources(params.directory, params.memo)
  if (ancestors === undefined) return undefined
  const fileReferences = fingerprintFileReferences(params.pluginConfig, params.directory)
  return JSON.stringify({
    config: params.agentCacheKey,
    pluginConfig: stableDigest(params.pluginConfig),
    components: stableDigest({ agents: params.pluginComponents.agents, plugins: params.pluginComponents.plugins }),
    global: params.globalSourcesFingerprint,
    project,
    ancestors,
    fileReferences: fileReferences.signature,
    // A file:// prompt is resolved and path-checked against the folder.
    directory: fileReferences.count > 0 ? params.directory : undefined,
  })
}

function attachHiddenConfigKeyAliases(
  config: Record<string, unknown>,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agents = config.agent
  if (typeof agents !== "object" || agents === null) {
    return
  }

  const agentMap = agents as Record<string, unknown>
  const overrides = pluginConfig.agents as
    | Record<string, { displayName?: string } | undefined>
    | undefined
  const configKeys = new Set([
    ...Object.keys(AGENT_DISPLAY_NAMES),
    ...Object.keys(overrides ?? {}),
  ])

  for (const configKey of configKeys) {
    const displayName = getAgentListDisplayName(configKey, overrides)
    if (!displayName || displayName === configKey) {
      continue
    }

    const displayEntry = agentMap[displayName]
    if (typeof displayEntry !== "object" || displayEntry === null) {
      continue
    }

    agentMap[configKey] = {
      ...(displayEntry as Record<string, unknown>),
      hidden: true,
    }
    registerAgentName(configKey)
  }
}

function replayAgentConfigSideEffects(params: {
  agentResult: Record<string, unknown>;
  configuredDefaultAgent: string | undefined;
  defaultAgent: unknown;
}): void {
  if (params.configuredDefaultAgent && typeof params.defaultAgent === "string") {
    setDefaultAgentForSort(params.defaultAgent)
  }
  clearRegisteredAgentNames()
  for (const name of Object.keys(params.agentResult)) {
    registerAgentName(name)
  }
}

/**
 * Test/telemetry seam: the most recent phase-timing record (local fix 29).
 * Lets the hermetic suite assert cache-hit behavior without mocking the
 * shared logger barrel (module mocks of ../shared leak across test files).
 */
let lastPhaseTiming: Record<string, unknown> | undefined;

export function getLastConfigHandlerPhaseTiming(): Record<string, unknown> | undefined {
  return lastPhaseTiming;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState, runtimeSkillSourceUrl } = deps;
  let agentConfigSnapshot: AgentConfigSnapshot | undefined;

  return async (config: Record<string, unknown>) => {
    openCodeShellTypeResolver.setConfiguredShell(config.shell);

    // Per-phase timing (local fix 29, first-message-drop F16): the cold plugin
    // setup had no attribution — OMO's share was only measurable end to end.
    // These numbers make the remaining cold-start cost attributable in
    // %TEMP%\oh-my-opencode.log.
    const phaseTiming: Record<string, number> = {};
    let agentsCacheHit = false;
    let componentsCacheHit = false;
    const timePhase = async <T>(name: string, run: () => Promise<T> | T): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await run();
      } finally {
        phaseTiming[name] = Date.now() - startedAt;
      }
    };
    const totalStartedAt = Date.now();

    const formatterConfig = config.formatter;

    await timePhase("provider", async () => {
      setAdditionalAllowedMcpEnvVars(pluginConfig.mcp_env_allowlist ?? [])
      applyOpenGatewayProviderConfig(config);
      applyProviderConfig({
        config,
        modelCacheState,
        trustedVisionCapableModels: collectTrustedVisionCapableModels(pluginConfig),
      });
      clearFormatterCache()
    });

    const cachedComponentsBefore = getProcessConfigCacheEntry("pluginComponents");
    const pluginComponents = await timePhase("pluginComponents", () =>
      loadPluginComponents({ pluginConfig }),
    );
    componentsCacheHit =
      cachedComponentsBefore !== undefined && cachedComponentsBefore.value === pluginComponents;
    const pluginComponentsLoadFailed = pluginComponents.retryableLoadFailure === true;

    await timePhase("hooks", () => applyHookConfig({ pluginComponents }));

    const fingerprintMemo: FingerprintMemo = new Map();
    const globalSourcesFingerprint = fingerprintGlobalSources(fingerprintMemo);
    const agentCacheKey = createAgentConfigCacheKey(config);
    let agentResult: Record<string, unknown>;
    const processAgentSnapshots = getProcessAgentSnapshotMap();
    // One key for the per-handler and the process snapshot, so a changed source
    // is never masked by a same-config hit. A source tree too large to
    // fingerprint keeps the upstream per-handler, config-only snapshot and is
    // never shared across handlers.
    const effectiveSnapshotKey = pluginComponentsLoadFailed
      ? undefined
      : createEffectiveAgentSnapshotKey({
          agentCacheKey,
          directory: ctx.directory,
          pluginConfig,
          pluginComponents,
          globalSourcesFingerprint,
          memo: fingerprintMemo,
        });
    const closureKey = effectiveSnapshotKey ?? agentCacheKey;
    const processSnapshot = effectiveSnapshotKey
      ? (processAgentSnapshots.get(effectiveSnapshotKey) as AgentConfigSnapshot | undefined)
      : undefined;
    const closureSnapshot = agentConfigSnapshot?.cacheKey === closureKey
      ? agentConfigSnapshot
      : undefined;
    const snapshot = closureSnapshot ?? processSnapshot;
    if (!pluginComponentsLoadFailed && snapshot) {
      config.agent = cloneAgentConfig(snapshot.agents);
      if (snapshot.defaultAgent !== undefined) {
        config.default_agent = snapshot.defaultAgent;
      }
      agentResult = config.agent as Record<string, unknown>;
      replayAgentConfigSideEffects({
        agentResult,
        configuredDefaultAgent: snapshot.configuredDefaultAgent,
        defaultAgent: config.default_agent,
      })
      agentsCacheHit = true;
    } else {
      const configuredDefaultAgent = await timePhase("agents", () => {
        return getConfiguredDefaultAgent(config);
      });
      agentResult = await timePhase("agents", () =>
        applyAgentConfig({
          config,
          pluginConfig,
          ctx,
          pluginComponents,
        }),
      );
      agentConfigSnapshot = pluginComponentsLoadFailed
        ? undefined
        : {
            cacheKey: closureKey,
            configuredDefaultAgent,
            defaultAgent: config.default_agent,
            agents: cloneAgentConfig(agentResult),
          };
      if (effectiveSnapshotKey && agentConfigSnapshot) {
        rememberAgentSnapshot(processAgentSnapshots, effectiveSnapshotKey, agentConfigSnapshot);
      }
    }

    await timePhase("tools", () =>
      applyToolConfig({ config, pluginConfig, agentResult }),
    );
    await timePhase("agentAliases", () => attachHiddenConfigKeyAliases(config, pluginConfig));
    await timePhase("mcp", () =>
      applyMcpConfig({ config, pluginConfig, ctx, pluginComponents }),
    );
    await timePhase("commands", () =>
      applyCommandConfig({
        config,
        pluginConfig,
        ctx,
        pluginComponents,
        globalSources: { fingerprint: globalSourcesFingerprint },
      }),
    );
    if (runtimeSkillSourceUrl) {
      await timePhase("runtimeSkills", () =>
        applyRuntimeSkillSourceConfig({
          config,
          pluginConfig,
          sourceUrl: runtimeSkillSourceUrl,
        }),
      );
    }

    config.formatter = formatterConfig;

    phaseTiming.total = Date.now() - totalStartedAt;
    lastPhaseTiming = {
      directory: ctx.directory,
      ...phaseTiming,
      agentsCacheHit,
      componentsCacheHit,
    };
    log("[config-handler] config handler applied", {
      agentCount: Object.keys(agentResult).length,
      commandCount: Object.keys((config.command as Record<string, unknown>) ?? {})
        .length,
    });
    log("[config-handler] phase timing", {
      directory: ctx.directory,
      ...phaseTiming,
      agentsCacheHit,
      componentsCacheHit,
    });
  };
}

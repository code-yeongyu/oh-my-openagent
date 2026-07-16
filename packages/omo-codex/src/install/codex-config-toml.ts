import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	ensureAgentConfig,
	removeStaleManagedAgentBlocks,
} from "./codex-config-agents";
import { writeFileAtomic } from "./codex-config-atomic-write";
import { ensureFeatureEnabled } from "./codex-config-features";
import {
	ensureMarketplaceBlock,
	hasMarketplaceBlock,
	legacyMarketplaceNames,
	removeMarketplaceBlock,
	removeStaleMarketplaceHookStateBlocks,
	removeStaleMarketplacePluginBlocks,
} from "./codex-config-marketplaces";
import { ensureAutonomousPermissions } from "./codex-config-permissions";
import {
	ensureHookTrusted,
	ensureOmoBuiltinMcpPolicies,
	ensurePluginEnabled,
} from "./codex-config-plugins";
import { ensureCodexReasoningConfig } from "./codex-config-reasoning";
import { readCodexModelCatalog } from "./codex-model-catalog";
import { removeUnsupportedCodexMultiAgentModeConfig } from "./codex-multi-agent-mode-config";
import {
	ensureCodexMultiAgentV2Config,
	resolveCodexMultiAgentVersion,
} from "./codex-multi-agent-v2-config";
import { isTomlLexicallyValid } from "./toml-lexical-lines";
import type {
	CodexAgentConfig,
	CodexInstallPlatform,
	CodexMarketplaceSource,
	TrustedHookState,
} from "./types";

export async function updateCodexConfig(input: {
	readonly configPath: string;
	readonly repoRoot: string;
	readonly marketplaceName: string;
	readonly marketplaceSource: CodexMarketplaceSource;
	readonly pluginNames: readonly string[];
	readonly platform?: CodexInstallPlatform;
	readonly codegraphMcpEnabled?: boolean;
	readonly gitBashEnabled?: boolean;
	readonly trustedHookStates?: readonly TrustedHookState[];
	readonly agentConfigs?: readonly CodexAgentConfig[];
	readonly autonomousPermissions?: boolean;
	readonly preserveMarketplaceSource?: boolean;
}): Promise<void> {
	await mkdir(dirname(input.configPath), { recursive: true });
	let config: string;
	try {
		config = await readFile(input.configPath, "utf8");
	} catch (error) {
		if (!isMissingFileError(error)) throw error;
		config = "";
	}
	if (!isTomlLexicallyValid(config)) return;

	const pluginSet = new Set(input.pluginNames);
	for (const legacyMarketplaceName of legacyMarketplaceNames(
		input.marketplaceName,
	)) {
		config = removeMarketplaceBlock(config, legacyMarketplaceName);
		config = removeStaleMarketplacePluginBlocks(
			config,
			legacyMarketplaceName,
			new Set(),
		);
		config = removeStaleMarketplaceHookStateBlocks(
			config,
			legacyMarketplaceName,
			new Set(),
		);
	}
	config = removeStaleMarketplacePluginBlocks(
		config,
		input.marketplaceName,
		pluginSet,
	);
	config = removeStaleMarketplaceHookStateBlocks(
		config,
		input.marketplaceName,
		pluginSet,
	);
	config = removeStaleManagedAgentBlocks(
		config,
		new Set((input.agentConfigs ?? []).map((agentConfig) => agentConfig.name)),
	);
	config = ensureFeatureEnabled(config, "plugins");
	config = ensureFeatureEnabled(config, "plugin_hooks");
	config = ensureFeatureEnabled(config, "multi_agent");
	config = removeUnsupportedCodexMultiAgentModeConfig(config);
	config = ensureCodexReasoningConfig(
		config,
		await readCodexModelCatalog(input.repoRoot),
	);
	config = ensureCodexMultiAgentV2Config(config, {
		multiAgentVersion: resolveCodexMultiAgentVersion(config, input.configPath),
	});
	if (input.autonomousPermissions === true)
		config = ensureAutonomousPermissions(config);
	if (
		!(
			input.preserveMarketplaceSource === true &&
			hasMarketplaceBlock(config, input.marketplaceName)
		)
	) {
		config = ensureMarketplaceBlock(
			config,
			input.marketplaceName,
			input.marketplaceSource,
		);
	}
	for (const pluginName of input.pluginNames) {
		config = ensurePluginEnabled(
			config,
			`${pluginName}@${input.marketplaceName}`,
		);
	}
	config = ensureOmoBuiltinMcpPolicies(config, input);
	for (const state of input.trustedHookStates ?? []) {
		config = ensureHookTrusted(config, state);
	}
	for (const agentConfig of input.agentConfigs ?? []) {
		config = ensureAgentConfig(config, agentConfig);
	}

	await writeFileAtomic(input.configPath, `${config.trimEnd()}\n`);
}

function isMissingFileError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

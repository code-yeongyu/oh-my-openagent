export interface CodexMarketplaceSource {
	sourceType: string;
	source: string;
	ref?: string;
}

export interface CodexTrustedHookState {
	key: string;
	trustedHash: string;
}

export interface CodexAgentConfig {
	name: string;
	configFile: string;
}

export interface UpdateCodexConfigOptions {
	configPath: string;
	repoRoot?: string;
	marketplaceName: string;
	marketplaceSource?: CodexMarketplaceSource;
	/**
	 * Leave any existing `[marketplaces.<name>]` block byte-identical and write
	 * nothing when it is absent. Used by the marketplace-flow bootstrap worker.
	 */
	preserveMarketplaceSource?: boolean;
	pluginNames: readonly string[];
	platform?: string;
	trustedHookStates?: readonly CodexTrustedHookState[];
	agentConfigs?: readonly CodexAgentConfig[];
	autonomousPermissions?: boolean;
	gitBashEnabled?: boolean;
}

export declare function updateCodexConfig(options: UpdateCodexConfigOptions): Promise<void>;

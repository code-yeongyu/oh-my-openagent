export interface TrustedHookState {
	key: string;
	trustedHash: string;
}

export declare function trustedHookStatesForPlugin(options: {
	marketplaceName: string;
	pluginName: string;
	pluginRoot: string;
}): Promise<TrustedHookState[]>;

export interface LinkedPluginAgent {
	name: string;
	path: string;
	target: string;
}

export declare function capturePreservedAgentReasoning(options: { codexHome: string }): Promise<Map<string, string>>;

export declare function capturePreservedAgentServiceTier(options: {
	codexHome: string;
}): Promise<Map<string, string | null>>;

export declare function linkCachedPluginAgents(options: {
	codexHome: string;
	pluginRoot: string;
	preservedReasoning?: Map<string, string>;
	preservedServiceTier?: Map<string, string | null>;
}): Promise<LinkedPluginAgent[]>;

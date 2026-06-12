export interface LinkedPluginBin {
	name: string;
	path: string;
	target: string;
}

export declare function linkCachedPluginBins(options: {
	binDir: string;
	pluginRoot: string;
	platform?: string;
}): Promise<LinkedPluginBin[]>;

export declare function linkRootRuntimeBin(options: {
	binDir: string;
	codexHome: string;
	repoRoot: string;
	platform?: string;
}): Promise<LinkedPluginBin | null>;

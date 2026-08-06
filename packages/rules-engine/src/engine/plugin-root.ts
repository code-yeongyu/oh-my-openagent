import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePluginRulesRoot(pluginRoot: string | undefined, moduleUrl = import.meta.url): string {
	const configuredRoot = pluginRoot ?? process.env["PLUGIN_ROOT"];
	if (configuredRoot !== undefined && configuredRoot.trim().length > 0) {
		return resolveRulesComponentRoot(resolve(configuredRoot));
	}

	return fileURLToPath(new URL("../../..", moduleUrl));
}

function resolveRulesComponentRoot(pluginRoot: string): string {
	const componentRoot = join(pluginRoot, "components", "rules");
	return isDirectory(componentRoot) ? componentRoot : pluginRoot;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

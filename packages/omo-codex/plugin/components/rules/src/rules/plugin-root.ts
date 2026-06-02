import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_MANIFEST_PATH = join(".codex-plugin", "plugin.json");

export function resolvePluginRulesRoot(pluginRoot: string | undefined, moduleUrl = import.meta.url): string {
	const configuredRoot = pluginRoot ?? process.env["PLUGIN_ROOT"];
	if (configuredRoot !== undefined && configuredRoot.trim().length > 0) {
		return resolveRulesComponentRoot(resolve(configuredRoot));
	}

	const discoveredRoot = findNearestPluginRoot(dirname(fileURLToPath(moduleUrl)));
	if (discoveredRoot !== null) {
		return resolveRulesComponentRoot(discoveredRoot);
	}

	return fileURLToPath(new URL("../../..", moduleUrl));
}

function findNearestPluginRoot(startDirectory: string): string | null {
	let currentDirectory = resolve(startDirectory);
	while (true) {
		if (isFile(join(currentDirectory, PLUGIN_MANIFEST_PATH))) {
			return currentDirectory;
		}

		const parentDirectory = dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			return null;
		}
		currentDirectory = parentDirectory;
	}
}

function resolveRulesComponentRoot(pluginRoot: string): string {
	const componentRoot = join(pluginRoot, "components", "rules");
	return isDirectory(componentRoot) ? componentRoot : pluginRoot;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

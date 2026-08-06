import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export async function configPaths({ env, cwd }) {
	const codexHome = resolve(env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
	const paths = new Set([join(codexHome, "config.toml")]);
	for (const projectConfig of projectConfigPaths({ cwd, stopAt: homedir() })) {
		if (!(await isRegularFile(projectConfig))) continue;
		if (!(await isRegularDirectory(dirname(projectConfig)))) continue;
		paths.add(projectConfig);
	}
	return [...paths];
}

function projectConfigPaths({ cwd, stopAt }) {
	const paths = [];
	let current = resolve(cwd);
	const stop = resolve(stopAt);
	while (true) {
		paths.push(join(current, ".codex", "config.toml"));
		if (current === stop || current === dirname(current)) break;
		current = dirname(current);
	}
	return paths;
}

async function isRegularFile(path) {
	try {
		return (await lstat(path)).isFile();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function isRegularDirectory(path) {
	try {
		return (await lstat(path)).isDirectory();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

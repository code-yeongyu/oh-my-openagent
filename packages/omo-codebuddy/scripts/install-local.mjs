#!/usr/bin/env node
/**
 * Installs this checkout as a local CodeBuddy marketplace.
 *
 * Why a marketplace: CodeBuddy loads plugins from marketplaces it knows about
 * (`/plugin marketplace add <dir>`), and a directory marketplace is the one
 * fully-offline channel. This script materializes that directory and, unless
 * told otherwise, registers it in the settings file for the chosen scope.
 *
 * Everything is scoped to `--root` (default `~/.codebuddy`), so QA can install
 * into a throwaway root and prove the real one is untouched.
 *
 *   install-local.mjs install   [--root DIR] [--scope user|project|local] [--link] [--json]
 *   install-local.mjs uninstall [--root DIR] [--scope user|project|local] [--json]
 *   install-local.mjs status    [--root DIR] [--json]
 *
 * The plugin is COPIED into the marketplace by default: CodeBuddy refuses a
 * marketplace entry whose source escapes the marketplace root, and a symlink
 * back to this checkout does exactly that
 * ("Plugin source path escapes marketplace root"). `--link` exists only for
 * hand-inspection of the layout; installing from a linked marketplace fails.
 */
import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginSource = join(packageRoot, "plugin");

export const MARKETPLACE_NAME = "omo-local";
export const PLUGIN_NAME = "omo";

const SCOPE_SETTINGS_FILE = {
	user: (root) => join(root, "settings.json"),
	project: (projectDir) => join(projectDir, ".codebuddy", "settings.json"),
	local: (projectDir) => join(projectDir, ".codebuddy", "settings.local.json"),
};

/** @typedef {{ command: string | undefined, root: string | undefined, scope: string, copy: boolean, json: boolean, projectDir: string }} InstallerArgs */

/**
 * @param {readonly string[]} argv
 * @returns {InstallerArgs}
 */
export function parseArgs(argv) {
	/** @type {InstallerArgs} */
	const args = { command: argv[0], root: undefined, scope: "user", copy: true, json: false, projectDir: process.cwd() };
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--root") args.root = argv[++index];
		else if (arg === "--scope") args.scope = argv[++index];
		else if (arg === "--project-dir") args.projectDir = argv[++index];
		else if (arg === "--copy") args.copy = true;
		else if (arg === "--link") args.copy = false;
		else if (arg === "--json") args.json = true;
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!["user", "project", "local"].includes(args.scope)) throw new Error(`unknown scope: ${args.scope}`);
	return args;
}

export function marketplaceDir(root) {
	return join(root, "plugins", MARKETPLACE_NAME);
}

export function installedPluginDir(root) {
	return join(marketplaceDir(root), "plugins", PLUGIN_NAME);
}

export function settingsPathFor(scope, root, projectDir) {
	return scope === "user" ? SCOPE_SETTINGS_FILE.user(root) : SCOPE_SETTINGS_FILE[scope](projectDir);
}

function marketplaceManifest() {
	return {
		name: MARKETPLACE_NAME,
		description: "Local checkout of oh-my-openagent (omo) for CodeBuddy.",
		owner: { name: "oh-my-openagent" },
		plugins: [
			{
				name: PLUGIN_NAME,
				source: `./plugins/${PLUGIN_NAME}`,
				description: "oh-my-openagent (omo): ultrawork, ulw workflows, agents, hooks and MCP servers for CodeBuddy.",
			},
		],
	};
}

async function linkOrCopy(source, target, copy) {
	await rm(target, { recursive: true, force: true });
	if (copy) {
		await cp(source, target, { recursive: true, dereference: true });
		return "copy";
	}
	try {
		await symlink(source, target, "dir");
		return "symlink";
	} catch {
		await cp(source, target, { recursive: true, dereference: true });
		return "copy";
	}
}

async function readSettings(path) {
	if (!existsSync(path)) return { settings: {}, existed: false, raw: null };
	const raw = await readFile(path, "utf8");
	const settings = raw.trim().length === 0 ? {} : JSON.parse(raw);
	return { settings, existed: true, raw };
}

export async function install({ root, scope, projectDir, copy }) {
	if (!existsSync(join(pluginSource, "hooks", "scripts", "hook.mjs"))) {
		// The build chain needs bun (it imports workspace TypeScript sources), so
		// it is loaded lazily: a plain `node install-local.mjs` against an
		// already-built checkout must not drag the TS graph into node's resolver.
		let buildPlugin;
		try {
			({ buildPlugin } = await import("./build-plugin.mjs"));
		} catch (error) {
			throw new Error(
				`the plugin is not built and building it needs bun: run \`bun scripts/build-plugin.mjs\` first (${error instanceof Error ? error.message : String(error)})`,
			);
		}
		await buildPlugin();
	}

	const marketDir = marketplaceDir(root);
	const target = installedPluginDir(root);
	await mkdir(dirname(target), { recursive: true });
	const mode = await linkOrCopy(pluginSource, target, copy);

	await mkdir(join(marketDir, ".codebuddy-plugin"), { recursive: true });
	await writeFile(
		join(marketDir, ".codebuddy-plugin", "marketplace.json"),
		`${JSON.stringify(marketplaceManifest(), null, 2)}\n`,
		"utf8",
	);

	const settingsPath = settingsPathFor(scope, root, projectDir);
	const { settings, existed, raw } = await readSettings(settingsPath);
	const next = {
		...settings,
		extraKnownMarketplaces: {
			...settings.extraKnownMarketplaces,
			[MARKETPLACE_NAME]: { source: { source: "directory", path: marketDir } },
		},
	};
	await mkdir(dirname(settingsPath), { recursive: true });
	if (existed && raw !== null) await writeFile(`${settingsPath}.omo-backup`, raw, "utf8");
	await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

	await writeFile(
		join(marketDir, ".omo-install.json"),
		`${JSON.stringify({ pluginRoot: pluginSource, target, mode, scope, settingsPath, installedAt: new Date().toISOString() }, null, 2)}\n`,
		"utf8",
	);

	return {
		marketplace: marketDir,
		plugin: target,
		mode,
		settingsPath,
		nextSteps: [
			`codebuddy plugin marketplace add ${marketDir}   # registers the local marketplace`,
			`codebuddy plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}   # installs into the versioned plugin cache`,
			`codebuddy --plugin-dir ${target}   # or one-shot session, no install`,
			`in a running session / the IDE: /plugin marketplace add ${marketDir}, then /plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`,
		],
	};
}

export async function uninstall({ root, scope, projectDir }) {
	const marketDir = marketplaceDir(root);
	const settingsPath = settingsPathFor(scope, root, projectDir);

	let removedSettings = false;
	if (existsSync(settingsPath)) {
		const { settings } = await readSettings(settingsPath);
		if (settings.extraKnownMarketplaces?.[MARKETPLACE_NAME] !== undefined) {
			const extra = { ...settings.extraKnownMarketplaces };
			delete extra[MARKETPLACE_NAME];
			const next = { ...settings, extraKnownMarketplaces: extra };
			await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
			removedSettings = true;
		}
	}

	let removedMarketplace = false;
	if (existsSync(marketDir)) {
		// Never follow the symlink out of the marketplace: remove the link itself.
		const stats = await lstat(join(marketDir, "plugins", PLUGIN_NAME)).catch(() => null);
		if (stats !== null) await rm(join(marketDir, "plugins", PLUGIN_NAME), { recursive: true, force: true });
		await rm(marketDir, { recursive: true, force: true });
		removedMarketplace = true;
	}

	return { marketplace: marketDir, settingsPath, removedMarketplace, removedSettings };
}

export function status({ root, scope, projectDir }) {
	const marketDir = marketplaceDir(root);
	const target = installedPluginDir(root);
	const settingsPath = settingsPathFor(scope, root, projectDir);
	return {
		root,
		scope,
		marketplace: { path: marketDir, exists: existsSync(marketDir) },
		plugin: { path: target, exists: existsSync(target) },
		settings: { path: settingsPath, exists: existsSync(settingsPath) },
	};
}

export async function run(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const root = resolve(args.root ?? join(homedir(), ".codebuddy"));

	if (args.command === "install") {
		const result = await install({ root, scope: args.scope, projectDir: resolve(args.projectDir), copy: args.copy });
		if (args.json) console.log(JSON.stringify(result, null, 2));
		else {
			console.log(`installed omo into ${result.plugin} (${result.mode})`);
			console.log(`marketplace: ${result.marketplace}`);
			console.log(`settings:    ${result.settingsPath}`);
			console.log("next steps:");
			for (const step of result.nextSteps) console.log(`  ${step}`);
		}
		return 0;
	}

	if (args.command === "uninstall") {
		const result = await uninstall({ root, scope: args.scope, projectDir: resolve(args.projectDir) });
		if (args.json) console.log(JSON.stringify(result, null, 2));
		else console.log(`uninstalled (marketplace removed: ${result.removedMarketplace}, settings cleaned: ${result.removedSettings})`);
		return 0;
	}

	if (args.command === "status") {
		const result = status({ root, scope: args.scope, projectDir: resolve(args.projectDir) });
		console.log(JSON.stringify(result, null, 2));
		return 0;
	}

	console.error("usage: install-local.mjs <install|uninstall|status> [--root DIR] [--scope user|project|local] [--link] [--json]");
	return 1;
}

if (import.meta.main) {
	process.exitCode = await run();
}

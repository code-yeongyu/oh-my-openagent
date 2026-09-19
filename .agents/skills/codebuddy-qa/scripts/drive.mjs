#!/usr/bin/env node
/**
 * Live CodeBuddy driver for the omo-codebuddy adapter QA.
 *
 * Every subcommand prints ONE JSON object on stdout so a QA run can be captured
 * as evidence verbatim.
 *
 *   drive.mjs discover                     # which CodeBuddy binaries exist
 *   drive.mjs probe      [--plugin DIR]    # CLI version + `plugin validate`
 *   drive.mjs hooks      [--plugin DIR]    # hermetic hook proof (bundle + payload)
 *   drive.mjs session    [--plugin DIR] [--prompt TEXT] [--timeout MS]
 *   drive.mjs isolation  [--root DIR]      # prove the real profile is untouched
 *   drive.mjs --self-test
 *
 * The live subcommands never write to the real `~/.codebuddy`: isolation is the
 * caller's job (`--root`), and `isolation` proves it happened.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "..", "..", "..", "..");
export const defaultPluginDir = join(repoRoot, "packages", "omo-codebuddy", "plugin");

export function candidateBinaries() {
	const home = process.env.HOME ?? "";
	// Order matters: the CodeBuddy Code AGENT CLI first (that is the harness
	// that loads plugins), then the IDE launcher (`buddycn`), which is a VS Code
	// fork with no plugin support and must never be mistaken for the CLI.
	return [
		process.env.CODEBUDDY_BIN,
		"codebuddy",
		join(home, ".codebuddy", "bin", "buddycn"),
		"/Applications/CodeBuddy CN.app/Contents/Resources/app/bin/code",
		"/Applications/CodeBuddy.app/Contents/Resources/app/bin/code",
	].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
}

export function discoverBinary() {
	for (const candidate of candidateBinaries()) {
		if (candidate.includes("/")) {
			if (existsSync(candidate)) return candidate;
			continue;
		}
		const which = spawnSync("which", [candidate], { encoding: "utf8" });
		if (which.status === 0 && which.stdout.trim().length > 0) return which.stdout.trim();
	}
	return null;
}

export function runCli(args, options = {}) {
	const binary = options.binary ?? discoverBinary();
	if (binary === null) return { ok: false, reason: "codebuddy binary not found", stdout: "", stderr: "", status: null };
	const result = spawnSync(binary, args, {
		encoding: "utf8",
		timeout: options.timeoutMs ?? 120_000,
		cwd: options.cwd ?? repoRoot,
		env: { ...process.env, ...(options.env ?? {}) },
	});
	return {
		ok: result.status === 0,
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error === undefined ? null : String(result.error),
		binary,
	};
}

export function digestFile(path) {
	if (!existsSync(path)) return { path, exists: false, sha256: null, bytes: 0 };
	const content = readFileSync(path);
	return {
		path,
		exists: true,
		sha256: createHash("sha256").update(content).digest("hex"),
		bytes: statSync(path).size,
	};
}

function hookPayloads(pluginDir, cwd) {
	return {
		"user-prompt-submit": {
			hook_event_name: "UserPromptSubmit",
			session_id: "qa-session",
			cwd,
			prompt: "ulw fix the failing test",
		},
		"session-start": { hook_event_name: "SessionStart", session_id: "qa-session", cwd },
		stop: { hook_event_name: "Stop", session_id: "qa-session", cwd, stop_hook_active: false },
		"post-tool-use": {
			hook_event_name: "PostToolUse",
			session_id: "qa-session",
			cwd,
			tool_name: "Edit",
			tool_input: { file_path: join(cwd, "sample.ts"), old_string: "a", new_string: "b" },
			tool_response: { success: true },
		},
		_empty: { hook_event_name: "UserPromptSubmit", session_id: "qa-session", cwd, prompt: "nothing here" },
		_pluginDir: pluginDir,
	};
}

export function runHook(pluginDir, command, payload, env = {}) {
	const script = join(pluginDir, "hooks", "scripts", "hook.mjs");
	if (!existsSync(script)) return { ok: false, reason: `missing ${script}` };
	const result = spawnSync("node", [script, command], {
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...process.env, CODEBUDDY_PLUGIN_ROOT: pluginDir, ...env },
	});
	return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function probe({ pluginDir }) {
	const version = runCli(["--version"]);
	const help = runCli(["--help"], { timeoutMs: 30_000 });
	const isAgentCli = (help.stdout ?? "").includes("--plugin-dir");
	const validation = isAgentCli
		? runCli(["plugin", "validate", pluginDir], { timeoutMs: 60_000 })
		: { ok: null, status: null, stdout: "", stderr: "", reason: "not the CodeBuddy Code agent CLI — `plugin` is not a subcommand" };
	return {
		binary: discoverBinary(),
		version: { ok: version.ok, status: version.status, stdout: version.stdout.trim(), stderr: version.stderr.trim() },
		pluginValidate: {
			ok: validation.ok,
			status: validation.status ?? null,
			stdout: (validation.stdout ?? "").trim().slice(0, 3000),
			stderr: (validation.stderr ?? "").trim().slice(0, 3000),
			reason: validation.reason ?? null,
		},
		// The CLI on PATH (`~/.codebuddy/bin/buddycn`) is the CodeBuddy IDE
		// launcher, a VS Code fork: it has NO `plugin` subcommand, so it can
		// neither validate nor drive a plugin. Detect that instead of reporting
		// a fake pass — a `plugin validate` run through it exits 0 because the
		// arguments are treated as paths to open.
		kind: (help.stdout ?? "").includes("Extensions Management") ? "ide-launcher" : "unknown",
		agentCliAvailable: (help.stdout ?? "").includes("--plugin-dir"),
		helpExcerpt: (help.stdout ?? "").slice(0, 2500),
		pluginDir: pluginDir,
	};
}

/**
 * Runs the agent CLI with arbitrary args (evidence gathering).
 *
 * `home` points the CLI at a throwaway CodeBuddy profile, which is how the
 * plugin install/list checks stay off the real one.
 */
export function cliArgs(args, { timeoutMs = 60_000, home = null } = {}) {
	const result = runCli(args, { timeoutMs, env: home === null ? {} : { HOME: home } });
	return {
		args,
		home,
		ok: result.ok,
		status: result.status,
		stdout: (result.stdout ?? "").slice(0, 12_000),
		stderr: (result.stderr ?? "").slice(0, 4000),
		error: result.error ?? null,
	};
}

/**
 * Format parity against plugins CodeBuddy actually loads.
 *
 * The installed marketplaces on this machine are the ground truth for the
 * manifest shape: compare the key sets of our plugin.json / hooks.json against
 * theirs, so a field CodeBuddy expects can never silently go missing.
 */
export function formatParity({ pluginDir }) {
	const home = process.env.HOME ?? "";
	const marketplacesRoot = join(home, ".codebuddy", "plugins", "marketplaces");
	const samples = [];
	if (existsSync(marketplacesRoot)) {
		for (const marketplace of readdirSafe(marketplacesRoot)) {
			const pluginsRoot = join(marketplacesRoot, marketplace, "plugins");
			for (const plugin of readdirSafe(pluginsRoot)) {
				const manifestPath = join(pluginsRoot, plugin, ".codebuddy-plugin", "plugin.json");
				const hooksPath = join(pluginsRoot, plugin, "hooks", "hooks.json");
				if (!existsSync(manifestPath) && !existsSync(hooksPath)) continue;
				samples.push({
					id: `${plugin}@${marketplace}`,
					manifestKeys: existsSync(manifestPath) ? Object.keys(readJson(manifestPath) ?? {}).sort() : [],
					hookEventNames: existsSync(hooksPath) ? Object.keys(readJson(hooksPath)?.hooks ?? {}).sort() : [],
				});
			}
		}
	}

	const ourManifest = readJson(join(pluginDir, ".codebuddy-plugin", "plugin.json")) ?? {};
	const ourHooks = readJson(join(pluginDir, "hooks", "hooks.json")) ?? {};
	const officialManifestKeys = new Set(samples.flatMap((sample) => sample.manifestKeys));
	const officialEvents = new Set(samples.flatMap((sample) => sample.hookEventNames));

	const ourKeys = Object.keys(ourManifest);
	const unknownKeys = ourKeys.filter((key) => !officialManifestKeys.has(key));
	const unknownEvents = Object.keys(ourHooks.hooks ?? {}).filter((event) => !officialEvents.has(event));

	return {
		sampledPlugins: samples.map((sample) => sample.id),
		ourManifestKeys: ourKeys.sort(),
		unknownManifestKeys: unknownKeys,
		officialManifestKeys: [...officialManifestKeys].sort(),
		ourHookEvents: Object.keys(ourHooks.hooks ?? {}).sort(),
		unknownHookEvents: unknownEvents,
		officialHookEvents: [...officialEvents].sort(),
		ok: samples.length > 0 && unknownKeys.length === 0 && unknownEvents.length === 0,
	};
}

function readdirSafe(dir) {
	try {
		return readdirSync(dir).filter((entry) => !entry.startsWith("."));
	} catch {
		return [];
	}
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

export function hooks({ pluginDir, cwd }) {
	const payloads = hookPayloads(pluginDir, cwd);
	const results = {};
	for (const command of ["user-prompt-submit", "session-start", "stop", "post-tool-use", "_empty"]) {
		const result = runHook(pluginDir, command, payloads[command]);
		results[command] = {
			status: result.status,
			stdout: result.stdout,
			stdoutBytes: result.stdout.length,
			parsed: parseMaybeJson(result.stdout),
		};
	}

	// Continuation proof: a workspace with an unfinished Boulder work owned by
	// this session must make the Stop hook ask for another turn.
	const continuationRoot = mkdtempSync(join(tmpdir(), "omo-codebuddy-continuation-"));
	try {
		mkdirSync(join(continuationRoot, ".omo"), { recursive: true });
		writeFileSync(join(continuationRoot, "plan.md"), "# Plan\n- [x] done\n- [ ] todo\n");
		writeFileSync(
			join(continuationRoot, ".omo", "boulder.json"),
			JSON.stringify({
				status: "active",
				work_id: "qa-work",
				active_plan: "plan.md",
				session_ids: ["codebuddy:qa-session"],
				started_at: new Date().toISOString(),
				plan_name: "plan",
			}),
		);
		const result = runHook(pluginDir, "stop", {
			hook_event_name: "Stop",
			session_id: "qa-session",
			cwd: continuationRoot,
			stop_hook_active: false,
		});
		results.stop_unfinished_work = {
			status: result.status,
			stdout: result.stdout,
			stdoutBytes: result.stdout.length,
			parsed: parseMaybeJson(result.stdout),
		};
	} finally {
		rmSync(continuationRoot, { recursive: true, force: true });
	}

	return results;
}

function parseMaybeJson(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return { unparsed: trimmed.slice(0, 200) };
	}
}

/**
 * Full install → verify → uninstall cycle inside a throwaway CodeBuddy root.
 * The installed copy is exercised through the bundled hook, and the root is
 * asserted EMPTY afterwards, so the QA proves the installer is reversible.
 */
export async function installCycle({ scope = "user" } = {}) {
	const throwaway = mkdtempSync(join(tmpdir(), "omo-codebuddy-install-"));
	const root = join(throwaway, ".codebuddy");
	const installer = await import(join(repoRoot, "packages", "omo-codebuddy", "scripts", "install-local.mjs"));
	const copy = true;

	const installed = await installer.install({ root, scope, projectDir: throwaway, copy });
	const afterInstall = installer.status({ root, scope, projectDir: throwaway });
	const hookResult = runHook(
		join(afterInstall.plugin.path, ""),
		"user-prompt-submit",
		hookPayloads(join(root, "plugins", "omo-local", "plugins", "omo"), throwaway)["user-prompt-submit"],
	);
	const removed = await installer.uninstall({ root, scope, projectDir: throwaway });
	const afterUninstall = installer.status({ root, scope, projectDir: throwaway });

	const settingsFile = join(root, "settings.json");
	const settingsAfterUninstall = existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : null;

	rmSync(throwaway, { recursive: true, force: true });

	return {
		scope,
		installed: { marketplace: installed.marketplace, plugin: installed.plugin, mode: installed.mode },
		afterInstall: { marketplace: afterInstall.marketplace.exists, plugin: afterInstall.plugin.exists, settings: afterInstall.settings.exists },
		installedPluginRuns: hookResult.status === 0 && hookResult.stdout.includes("<ultrawork-mode>"),
		removed: { marketplace: removed.removedMarketplace, settingsEntry: removed.removedSettings },
		afterUninstall: {
			marketplace: afterUninstall.marketplace.exists,
			plugin: afterUninstall.plugin.exists,
			settingsHasOurEntry: settingsAfterUninstall === null ? false : settingsAfterUninstall.includes("omo-local"),
		},
	};
}

export function isolation({ root }) {
	const home = process.env.HOME ?? "";
	return {
		realProfile: digestFile(join(home, ".codebuddy", "settings.json")),
		realKnownMarketplaces: digestFile(join(home, ".codebuddy", "plugins", "known_marketplaces.json")),
		throwawayRoot: root ?? null,
		isolated: root !== undefined,
	};
}

/**
 * One real CodeBuddy Code turn.
 *
 * The session ALWAYS runs in a throwaway project directory, so no session
 * artifact lands in the repository. `home: "isolated"` also points HOME at a
 * temp dir — that proves nothing about a logged-out machine, so it only works
 * if the CLI can authenticate without the real profile (it cannot on a
 * logged-in-by-account machine: "Authentication required").
 *
 * `home: "real"` therefore uses the real credentials, which is the ONLY way to
 * drive a live turn here. That is an accepted, recorded side effect: session
 * history may be appended under the real profile, and the caller must digest
 * the profile before/after and report what changed.
 */
export function session({ pluginDir, prompt, timeoutMs, home = "real", debug = null }) {
	const workdir = mkdtempSync(join(tmpdir(), "omo-codebuddy-session-"));
	const env = home === "isolated" ? { HOME: workdir, CODEBUDDY_CONFIG_DIR: join(workdir, ".codebuddy") } : {};
	const args = ["--plugin-dir", pluginDir];
	if (debug !== null) args.push("--debug", debug);
	args.push("-p", prompt);

	try {
		const result = runCli(args, { timeoutMs, cwd: workdir, env });
		return {
			home,
			cwd: workdir,
			ok: result.ok,
			status: result.status,
			stdout: result.stdout.slice(0, 8000),
			stderr: result.stderr.slice(0, 6000),
			error: result.error,
		};
	} finally {
		rmSync(workdir, { recursive: true, force: true });
	}
}

function parseFlags(argv) {
	const flags = {};
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--plugin") flags.pluginDir = argv[++index];
		else if (argv[index] === "--root") flags.root = argv[++index];
		else if (argv[index] === "--prompt") flags.prompt = argv[++index];
		else if (argv[index] === "--timeout") flags.timeoutMs = Number(argv[++index]);
		else if (argv[index] === "--scope") flags.scope = argv[++index];
		else if (argv[index] === "--home") flags.home = argv[++index];
		else if (argv[index] === "--debug") flags.debug = argv[++index];
		else if (argv[index] === "--args") flags.args = argv[++index];
	}
	flags.pluginDir = resolve(flags.pluginDir ?? defaultPluginDir);
	return flags;
}

function selfTest() {
	const checks = [];
	checks.push(["plugin dir exists", existsSync(defaultPluginDir)]);
	checks.push(["hook bundle exists", existsSync(join(defaultPluginDir, "hooks", "scripts", "hook.mjs"))]);
	checks.push(["candidates listed", candidateBinaries().length >= 3]);

	const cwd = mkdtempSync(join(tmpdir(), "omo-codebuddy-selftest-"));
	try {
		const result = runHook(defaultPluginDir, "user-prompt-submit", hookPayloads(defaultPluginDir, cwd)["user-prompt-submit"]);
		checks.push(["hook runs", result.status === 0]);
		checks.push(["hook injects ultrawork", result.stdout.includes("<ultrawork-mode>")]);
		const silent = runHook(defaultPluginDir, "user-prompt-submit", hookPayloads(defaultPluginDir, cwd)._empty);
		checks.push(["hook stays silent without a trigger", silent.stdout === ""]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}

	const failed = checks.filter(([, ok]) => !ok);
	return { ok: failed.length === 0, checks: checks.map(([name, ok]) => ({ name, ok })), failed: failed.map(([name]) => name) };
}

if (import.meta.main) {
	const [command, ...rest] = process.argv.slice(2);
	const flags = parseFlags(rest);

	if (command === "--self-test") {
		const result = selfTest();
		console.log(JSON.stringify(result, null, 2));
		process.exitCode = result.ok ? 0 : 1;
	} else if (command === "discover") {
		console.log(JSON.stringify({ candidates: candidateBinaries(), resolved: discoverBinary() }, null, 2));
	} else if (command === "probe") {
		console.log(JSON.stringify(probe(flags), null, 2));
	} else if (command === "format-parity") {
		console.log(JSON.stringify(formatParity(flags), null, 2));
	} else if (command === "hooks") {
		console.log(JSON.stringify(hooks({ pluginDir: flags.pluginDir, cwd: repoRoot }), null, 2));
	} else if (command === "session") {
		console.log(
			JSON.stringify(
				session({
					pluginDir: flags.pluginDir,
					prompt: flags.prompt ?? "Reply with exactly: OMO-QA-OK",
					timeoutMs: flags.timeoutMs ?? 180_000,
					home: flags.home ?? "real",
					debug: flags.debug ?? null,
				}),
				null,
				2,
			),
		);
	} else if (command === "isolation") {
		console.log(JSON.stringify(isolation({ root: flags.root }), null, 2));
	} else if (command === "install") {
		console.log(JSON.stringify(await installCycle({ scope: flags.scope ?? "user" }), null, 2));
	} else if (command === "cli") {
		console.log(
			JSON.stringify(
				cliArgs((flags.args ?? "").split(" ").filter((part) => part.length > 0), { home: flags.home ?? null }),
				null,
				2,
			),
		);
	} else {
		console.error("unknown command; see the header of this file");
		process.exitCode = 2;
	}
}

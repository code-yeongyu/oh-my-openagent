import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { contextCwd, lspRequestContext } from "../request-context.js";
import { getMergedServers, type ServerWithSource } from "./config-loader.js";
import { isServerInstalled } from "./server-installation.js";
import { effectiveExtension } from "./effective-extension.js";
import { EXT_TO_LANG } from "./language-mappings.js";
import { LSP_INSTALL_HINTS, LSP_LOCAL_INSTALL_HINTS } from "./server-definitions.js";
import { LSP_PROBE_FIXTURES, type LspProbeFixture, type LspProbeResult, probeLspServer } from "./server-probe.js";
import { BUILTIN_SERVER_PROJECT_MARKERS, findServerForExtension, hasProjectMarker } from "./server-resolution.js";
import type { ResolvedServer } from "./types.js";

/**
 * How one language's LSP support stands, most useful first:
 * - `ok`: a server was resolved, started, initialized and answered a request about a fixture.
 * - `unverified`: a server resolves but there is no fixture for the language, so it was not started.
 * - `missing`: a server is configured for the language but its executable is not installed.
 * - `unconfigured`: no server, built-in or configured, handles the language.
 * - `wrong_routing`: the server picked for the language does not belong to this project (e.g.
 *   `deno lsp` chosen for a Bun/Node project because the TypeScript server is missing).
 * - `startup_failed` / `timeout` / `request_failed`: the server resolved but did not work.
 */
export type LspComponentStatus =
	| "ok"
	| "unverified"
	| "missing"
	| "unconfigured"
	| "wrong_routing"
	| "startup_failed"
	| "timeout"
	| "request_failed";

export interface LspLanguageReport {
	readonly language: string;
	readonly extension: string;
	/** Required languages fail the check when they are not `ok`. */
	readonly required: boolean;
	/** Files of this language seen in the project scan (capped by the scan limit). */
	readonly projectFiles: number;
	readonly status: LspComponentStatus;
	readonly serverId: string | null;
	/** Absolute path of the executable that would be spawned, when one resolved. */
	readonly executable: string | null;
	readonly probe: LspProbeResult | null;
	readonly detail: string;
	readonly remediation: readonly string[];
}

export interface LspComponentReport {
	readonly cwd: string;
	readonly scannedEntries: number;
	readonly languages: readonly LspLanguageReport[];
}

export interface CheckLspComponentsOptions {
	/** Language ids (or aliases such as `bash`, `ts`, `yml`) that must work. */
	readonly requiredLanguages?: readonly string[];
	/** Set false to resolve servers without starting them. */
	readonly probe?: boolean;
	readonly scanLimit?: number;
	readonly concurrency?: number;
	readonly probeServer?: (server: ResolvedServer, fixture: LspProbeFixture) => Promise<LspProbeResult>;
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
	ts: "typescript",
	tsx: "typescriptreact",
	js: "javascript",
	jsx: "javascriptreact",
	bash: "shellscript",
	sh: "shellscript",
	shell: "shellscript",
	zsh: "shellscript",
	yml: "yaml",
	md: "markdown",
	docker: "dockerfile",
	py: "python",
};

const SKIP_DIRECTORIES = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	"vendor",
	"target",
	".venv",
	"venv",
	"__pycache__",
]);
const DEFAULT_SCAN_LIMIT = 5_000;
const DEFAULT_CONCURRENCY = 4;
const FAILING_STATUSES = new Set<LspComponentStatus>([
	"missing",
	"wrong_routing",
	"startup_failed",
	"timeout",
	"request_failed",
]);

export function normalizeLanguageId(language: string): string {
	const lowered = language.trim().toLowerCase();
	return LANGUAGE_ALIASES[lowered] ?? lowered;
}

/** True when the language's status should be reported as a problem. */
export function isLspLanguageProblem(report: LspLanguageReport): boolean {
	if (report.required) return report.status !== "ok";
	return FAILING_STATUSES.has(report.status);
}

interface LanguageUsage {
	count: number;
	extensions: Map<string, number>;
}

/**
 * Counts project files per language. Nested repositories and worktrees (a directory holding its
 * own `.git`) are skipped: they are other projects, and a few checkouts would exhaust the limit.
 */
export function scanProjectLanguages(
	root: string,
	limit = DEFAULT_SCAN_LIMIT,
): { readonly usage: Map<string, LanguageUsage>; readonly scanned: number } {
	const usage = new Map<string, LanguageUsage>();
	let scanned = 0;

	const walk = (directory: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(directory);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (scanned >= limit) return;
			const fullPath = join(directory, entry);
			let stat: ReturnType<typeof lstatSync>;
			try {
				stat = lstatSync(fullPath);
			} catch {
				continue;
			}
			if (stat.isSymbolicLink()) continue;
			scanned++;
			if (stat.isDirectory()) {
				if (SKIP_DIRECTORIES.has(entry) || existsSync(join(fullPath, ".git"))) continue;
				walk(fullPath);
				continue;
			}
			if (!stat.isFile()) continue;
			const extension = effectiveExtension(fullPath);
			const language = extension ? EXT_TO_LANG[extension] : undefined;
			if (language === undefined || extension === undefined) continue;
			const current = usage.get(language) ?? { count: 0, extensions: new Map<string, number>() };
			current.count++;
			current.extensions.set(extension, (current.extensions.get(extension) ?? 0) + 1);
			usage.set(language, current);
		}
	};

	walk(root);
	return { usage, scanned };
}

function mostCommonExtension(usage: LanguageUsage | undefined): string | null {
	if (usage === undefined) return null;
	let best: string | null = null;
	let bestCount = 0;
	for (const [extension, count] of usage.extensions) {
		if (count > bestCount) {
			best = extension;
			bestCount = count;
		}
	}
	return best;
}

function fixtureExtension(language: string): string | null {
	const fixture = LSP_PROBE_FIXTURES[language];
	return fixture === undefined ? null : effectiveExtension(fixture.fileName);
}

function installRemediation(serverId: string, command: string): string[] {
	const local = LSP_LOCAL_INSTALL_HINTS[serverId];
	const global = LSP_INSTALL_HINTS[serverId] ?? `Install '${command}' and ensure it is on PATH`;
	return local === undefined ? [global] : [`${local} (in the project)`, `${global} (globally)`];
}

function unconfiguredRemediation(extension: string): string[] {
	const context = lspRequestContext();
	return [
		`Add a server for ${extension} to ${context.userConfigPath}: { "lsp": { "<id>": { "command": ["<server>", "--stdio"], "extensions": ["${extension}"] } } }`,
	];
}

interface PlannedLanguage {
	readonly language: string;
	readonly extension: string;
	readonly required: boolean;
	readonly projectFiles: number;
}

function planLanguages(
	usage: Map<string, LanguageUsage>,
	requiredLanguages: readonly string[],
): { planned: PlannedLanguage[]; unknown: string[] } {
	const required = new Set(requiredLanguages.map(normalizeLanguageId));
	const languages = new Set([...usage.keys(), ...required]);
	const planned: PlannedLanguage[] = [];
	const unknown: string[] = [];
	for (const language of languages) {
		const extension = mostCommonExtension(usage.get(language)) ?? fixtureExtension(language);
		if (extension === null) {
			unknown.push(language);
			continue;
		}
		planned.push({
			language,
			extension,
			required: required.has(language),
			projectFiles: usage.get(language)?.count ?? 0,
		});
	}
	planned.sort((a, b) => Number(b.required) - Number(a.required) || b.projectFiles - a.projectFiles);
	return { planned, unknown };
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			const item = items[index];
			if (item !== undefined) results[index] = await fn(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

/**
 * Checks, for every language the project uses plus every required language, that the server
 * OMO's runtime would pick actually works: resolution through the same config merge and binary
 * lookup as `withLspClient()`, a routing sanity check, then a bounded functional probe.
 *
 * Must run inside `runWithRequestContext()` so config paths match the running LSP tools.
 * Never installs anything; remediation is returned as text for a person or agent to act on.
 */
export async function checkLspComponents(options: CheckLspComponentsOptions = {}): Promise<LspComponentReport> {
	const cwd = contextCwd();
	const { usage, scanned } = scanProjectLanguages(cwd, options.scanLimit ?? DEFAULT_SCAN_LIMIT);
	const { planned, unknown } = planLanguages(usage, options.requiredLanguages ?? []);
	const probeServer = options.probeServer ?? ((server, fixture) => probeLspServer(server, fixture));
	const shouldProbe = options.probe ?? true;

	const probes = new Map<string, Promise<LspProbeResult>>();
	const probeOnce = (server: ResolvedServer, fixture: LspProbeFixture): Promise<LspProbeResult> => {
		const key = JSON.stringify([server.id, server.command, fixture.fileName]);
		let pending = probes.get(key);
		if (pending === undefined) {
			pending = probeServer(server, fixture);
			probes.set(key, pending);
		}
		return pending;
	};

	const reports = await mapWithConcurrency(planned, options.concurrency ?? DEFAULT_CONCURRENCY, (entry) =>
		assessLanguage(entry, cwd, shouldProbe, probeOnce),
	);

	for (const language of unknown) {
		reports.push({
			language,
			extension: "",
			required: true,
			projectFiles: 0,
			status: "unconfigured",
			serverId: null,
			executable: null,
			probe: null,
			detail: `Unknown language id '${language}'; use an LSP language id such as typescript, shellscript or yaml.`,
			remediation: [],
		});
	}

	return { cwd, scannedEntries: scanned, languages: reports };
}

async function assessLanguage(
	entry: PlannedLanguage,
	cwd: string,
	shouldProbe: boolean,
	probeOnce: (server: ResolvedServer, fixture: LspProbeFixture) => Promise<LspProbeResult>,
): Promise<LspLanguageReport> {
	const base = { language: entry.language, extension: entry.extension, required: entry.required, projectFiles: entry.projectFiles };
	const lookup = findServerForExtension(entry.extension);

	if (lookup.status === "not_configured") {
		return {
			...base,
			status: "unconfigured",
			serverId: null,
			executable: null,
			probe: null,
			detail: `No LSP server handles ${entry.extension}.`,
			remediation: unconfiguredRemediation(entry.extension),
		};
	}

	if (lookup.status === "not_installed") {
		const command = lookup.server.command[0] ?? lookup.server.id;
		return {
			...base,
			status: "missing",
			serverId: lookup.server.id,
			executable: null,
			probe: null,
			detail: `Server '${lookup.server.id}' is configured for ${entry.extension} but '${command}' is not installed.`,
			remediation: installRemediation(lookup.server.id, command),
		};
	}

	const server = lookup.server;
	const executable = server.command[0] ?? null;
	const markers = BUILTIN_SERVER_PROJECT_MARKERS[server.id];
	const misrouted = markers !== undefined && !hasProjectMarker(cwd, markers);
	const fixture = LSP_PROBE_FIXTURES[entry.language];
	const probe = shouldProbe && fixture !== undefined ? await probeOnce(server, fixture) : null;

	if (misrouted) {
		const preferred = findAlternativeServer(entry.extension, server.id);
		return {
			...base,
			status: "wrong_routing",
			serverId: server.id,
			executable,
			probe,
			detail:
				`Server '${server.id}' was selected for ${entry.extension}, but the project has no ${markers.join(" or ")}` +
				(preferred === null ? "." : `; '${preferred}' also handles ${entry.extension}.`),
			remediation: [
				...(preferred === null ? [] : installRemediation(preferred, preferred)),
				`Or disable it in ${lspRequestContext().userConfigPath}: { "lsp": { "${server.id}": { "disabled": true } } }`,
			],
		};
	}

	if (probe === null) {
		return {
			...base,
			status: "unverified",
			serverId: server.id,
			executable,
			probe: null,
			detail: shouldProbe
				? `Server '${server.id}' resolves; no probe fixture exists for ${entry.language}, so it was not started.`
				: `Server '${server.id}' resolves; probing was disabled.`,
			remediation: [],
		};
	}

	if (probe.status === "ok") {
		return {
			...base,
			status: "ok",
			serverId: server.id,
			executable,
			probe,
			detail: `Server '${server.id}' initialized and answered documentSymbol (${probe.symbols} symbol(s)) in ${probe.durationMs}ms.`,
			remediation: [],
		};
	}

	const skipped = findSkippedServer(entry.extension, server.id, cwd);
	if (skipped !== null) {
		const command = skipped.command[0] ?? skipped.id;
		return {
			...base,
			status: "missing",
			serverId: skipped.id,
			executable: null,
			probe,
			detail:
				`Server '${skipped.id}' is configured for ${entry.extension} but '${command}' is not installed, so ` +
				`'${server.id}' was selected instead and failed at ${probe.stage}: ${probe.detail}`,
			remediation: installRemediation(skipped.id, command),
		};
	}

	return {
		...base,
		status: probe.status,
		serverId: server.id,
		executable,
		probe,
		detail: `Server '${server.id}' failed at ${probe.stage}: ${probe.detail}`,
		remediation: [`Run '${executable ?? server.id}' by hand to see why it does not start, or reinstall it.`],
	};
}

/**
 * The first server ahead of `selectedId` for the extension that applies to this project but is not
 * installed. A failing fallback (eslint or biome for .ts, chosen because typescript-language-server
 * is absent) is then reported as the preferred server missing, which is what installing fixes.
 */
function findSkippedServer(extension: string, selectedId: string, cwd: string): ServerWithSource | null {
	for (const server of getMergedServers()) {
		if (!server.extensions.includes(extension)) continue;
		if (server.id === selectedId) return null;
		const markers = server.source === "builtin" ? BUILTIN_SERVER_PROJECT_MARKERS[server.id] : undefined;
		if (markers !== undefined && !hasProjectMarker(cwd, markers)) continue;
		if (!isServerInstalled(server.command, cwd)) return server;
	}
	return null;
}

function findAlternativeServer(extension: string, selectedId: string): string | null {
	for (const server of getMergedServers()) {
		if (server.id !== selectedId && server.extensions.includes(extension)) return server.id;
	}
	return null;
}

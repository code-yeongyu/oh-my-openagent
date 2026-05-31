import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH";
const SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY = "OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL";
const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
const WINGET_INSTALL_ARGS = ["install", "--id", "Git.Git", "-e", "--source", "winget"];

export function resolveGitBash({ platform, env, exists, where }) {
	if (platform !== "win32") return { found: true, path: null, source: "not-required" };

	const checkedPaths = [];
	const envPath = nonEmptyEnvValue(env, GIT_BASH_ENV_KEY);
	if (envPath !== undefined) {
		checkedPaths.push(envPath);
		if (isBashExePath(envPath) && exists(envPath)) return { found: true, path: envPath, source: "env" };
		return missingGitBash(checkedPaths);
	}

	for (const candidate of [
		{ path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
		{ path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" },
	]) {
		checkedPaths.push(candidate.path);
		if (exists(candidate.path)) return { found: true, path: candidate.path, source: candidate.source };
	}

	for (const pathCandidate of where("bash")) {
		const candidate = pathCandidate.trim();
		if (candidate.length === 0) continue;
		checkedPaths.push(candidate);
		if (isBashExePath(candidate) && exists(candidate)) return { found: true, path: candidate, source: "path" };
	}

	return missingGitBash(checkedPaths);
}

export function resolveGitBashForCurrentProcess(options = {}) {
	return resolveGitBash({
		platform: options.platform ?? process.platform,
		env: options.env ?? process.env,
		exists: existsSync,
		where: whereCommand,
	});
}

export async function prepareGitBashForInstall(options) {
	const resolveGitBashWithDefaults = options.resolveGitBash
		?? (() => resolveGitBashForCurrentProcess({ platform: options.platform, env: options.env }));
	const initialResolution = resolveGitBashWithDefaults();
	if (options.platform !== "win32" || initialResolution.found) return initialResolution;
	if (options.env[SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY] === "1") return initialResolution;

	try {
		await options.runCommand("winget", WINGET_INSTALL_ARGS, { cwd: options.cwd });
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return initialResolution;
	}

	return resolveGitBashWithDefaults();
}

function missingGitBash(checkedPaths) {
	return {
		found: false,
		checkedPaths,
		installHint: [
			"Git Bash is required for native Windows Codex profile installs.",
			"Install it with: winget install --id Git.Git -e --source winget",
			`For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`,
			"Then rerun `bunx omo install --platform=codex`.",
		].join("\n"),
	};
}

function nonEmptyEnvValue(env, key) {
	const value = env[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

function isBashExePath(path) {
	return path.toLowerCase().endsWith("bash.exe");
}

function whereCommand(command) {
	try {
		return execFileSync("where", [command], { encoding: "utf8" })
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch (error) {
		if (error instanceof Error) return [];
		throw error;
	}
}

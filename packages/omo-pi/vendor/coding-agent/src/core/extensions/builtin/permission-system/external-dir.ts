import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function expandHome(inputPath: string): string {
	if (inputPath === "~") {
		return os.homedir();
	}
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return path.join(os.homedir(), inputPath.slice(2));
	}
	if (inputPath.startsWith("$HOME/") || inputPath.startsWith("$HOME\\")) {
		return path.join(os.homedir(), inputPath.slice(6));
	}
	if (inputPath === "$HOME") {
		return os.homedir();
	}
	return inputPath;
}

function normalizePath(inputPath: string): string {
	try {
		if (fs.existsSync(inputPath)) {
			return fs.realpathSync(inputPath);
		}
	} catch {}
	return path.normalize(inputPath);
}

export function isExternalPath(inputPath: string, cwd: string): boolean {
	const expandedPath = expandHome(inputPath);
	const normalizedCwd = normalizePath(cwd);
	const absolutePath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(normalizedCwd, expandedPath);
	const normalizedTarget = normalizePath(absolutePath);

	if (normalizedTarget === normalizedCwd) {
		return false;
	}

	const cwdWithSeparator = normalizedCwd.endsWith(path.sep) ? normalizedCwd : normalizedCwd + path.sep;

	return !normalizedTarget.startsWith(cwdWithSeparator);
}

function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuotes: string | null = null;
	let escaped = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			escaped = true;
			current += char;
			continue;
		}

		if (inQuotes) {
			if (char === inQuotes) {
				inQuotes = null;
			}
			current += char;
			continue;
		}

		if (char === '"' || char === "'") {
			inQuotes = char;
			current += char;
			continue;
		}

		if (char === " " || char === "\t") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

function unquote(token: string): string {
	if (token.length < 2) return token;
	const first = token[0];
	const last = token[token.length - 1];
	if ((first === '"' || first === "'") && first === last) {
		return token.slice(1, -1);
	}
	return token;
}

function looksLikePath(token: string): boolean {
	if (token.startsWith("-")) return false;
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return false;
	if (["|", "||", "&&", ";", "&", "$(", "${", "`"].some((op) => token.includes(op))) {
		return false;
	}
	if (token.startsWith("/")) return true;
	if (token.startsWith("~")) return true;
	if (token.startsWith("$HOME")) return true;
	if (token.startsWith("./") || token.startsWith("../")) return true;
	if (token.includes("/")) return true;

	return false;
}

export function extractExternalPaths(command: string, cwd: string): string[] {
	const tokens = tokenizeCommand(command);
	const externalPaths: string[] = [];

	let startIndex = 0;
	if (tokens.length > 0) {
		const firstToken = unquote(tokens[0]);
		if (
			!firstToken.startsWith("/") &&
			!firstToken.startsWith("~") &&
			!firstToken.startsWith("$") &&
			!firstToken.startsWith("./") &&
			!firstToken.startsWith("../") &&
			!firstToken.includes("/")
		) {
			startIndex = 1;
		}
	}

	for (let i = startIndex; i < tokens.length; i++) {
		const token = unquote(tokens[i]);

		if (!looksLikePath(token)) {
			continue;
		}

		if (isExternalPath(token, cwd)) {
			externalPaths.push(token);
		}
	}

	return externalPaths;
}

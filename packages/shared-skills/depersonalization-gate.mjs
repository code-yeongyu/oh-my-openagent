#!/usr/bin/env node
// De-personalization deny-list gate for shared skills that were vendored from a
// personal machine. Scans for PERSONAL IDENTITY and CREDENTIAL leakage only.
// It is deliberately NOT the engine's bias_check.py (a no-site-name scanner) and
// it deliberately does NOT deny intentionally-kept tier/tool names like
// `agent-reach`, `xhs`, or `mcporter`.
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SCAN_DIRS = [
	join(here, "skills", "ultimate-browsing"),
	join(here, "skills", "ultraresearch"),
];

// Frozen deny list: personal identity + credential literals only.
// Each entry is a labeled RegExp. Intentionally-kept tier/tool names
// (`agent-reach`, `xhs`, `mcporter`) are NOT on this list.
/** @type {Array<[string, RegExp]>} */
const DENY_RULES = [
	["personal-handle:yeongyu", /yeongyu/i],
	["personal-host:jobdori", /jobdori/i],
	["personal-gateway:quotio", /quotio/i],
	["personal-browser-tier:aside", /\baside\b/i],
	["personal-browser-choice:zen", /--browser\s+zen|\bbrowser\s+zen\b/i],
	["credential-literal:TWITTER_AUTH_TOKEN", /TWITTER_AUTH_TOKEN/],
	["credential-literal:TWITTER_CT0", /TWITTER_CT0/],
	["credential-literal:GROQ_API_KEY", /GROQ_API_KEY/],
	["platform-token:xsec_token", /xsec_token/],
	["home-path:/Users/<name>", /\/Users\/[A-Za-z0-9._-]+\//],
	["home-path:/home/<name>", /\/home\/[A-Za-z0-9._-]+\//],
	["home-path:C:\\Users\\<name>", /C:\\Users\\[A-Za-z0-9._-]+/i],
	["bearer-literal", /\bBearer\s+[A-Za-z0-9._-]{12,}/],
	["agent-reach-home", /(?:~|\$HOME)\/\.agent-reach\//],
];

const TEXT_EXTENSIONS = new Set([".md", ".py", ".yaml", ".yml", ".json", ".js", ".mjs", ".ts", ".txt", ".sh"]);
const SKIP_DIR_NAMES = new Set(["__pycache__", "node_modules", ".git"]);

function fileExtension(name) {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot);
}

async function collectFiles(rootDir) {
	const out = [];
	async function walk(dir) {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIR_NAMES.has(entry.name)) continue;
				await walk(full);
			} else if (entry.isFile() && TEXT_EXTENSIONS.has(fileExtension(entry.name))) {
				out.push(full);
			}
		}
	}
	await walk(rootDir);
	return out;
}

async function scanFile(file, baseDir) {
	const content = await readFile(file, "utf8");
	const lines = content.split("\n");
	const violations = [];
	for (let i = 0; i < lines.length; i++) {
		for (const [label, pattern] of DENY_RULES) {
			if (pattern.test(lines[i])) {
				violations.push({ label, file: relative(baseDir, file), line: i + 1, text: lines[i].trim().slice(0, 120) });
			}
		}
	}
	return violations;
}

export async function runDepersonalizationGate(scanDirs = DEFAULT_SCAN_DIRS, baseDir = here) {
	const violations = [];
	for (const dir of scanDirs) {
		try {
			await stat(dir);
		} catch {
			continue;
		}
		const files = await collectFiles(dir);
		for (const file of files) {
			violations.push(...(await scanFile(file, baseDir)));
		}
	}
	return violations;
}

async function main() {
	const args = process.argv.slice(2);
	const rootIndex = args.indexOf("--root");
	const scanDirs = rootIndex !== -1 && args[rootIndex + 1] ? [args[rootIndex + 1]] : DEFAULT_SCAN_DIRS;
	const baseDir = rootIndex !== -1 && args[rootIndex + 1] ? args[rootIndex + 1] : here;
	const violations = await runDepersonalizationGate(scanDirs, baseDir);
	if (violations.length === 0) {
		console.log("OK: no personal-identity or credential leakage found.");
		return;
	}
	console.error(`FAIL: ${violations.length} personal-context violation(s):`);
	for (const v of violations) {
		console.error(`  [${v.label}] ${v.file}:${v.line}  ${v.text}`);
	}
	process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await main();
}

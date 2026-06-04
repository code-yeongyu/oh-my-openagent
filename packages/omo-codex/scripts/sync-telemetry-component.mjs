#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TELEMETRY_SYNC_FILES = [
	"atomic-write.ts",
	"data-path.ts",
	"diagnostics.ts",
	"env-flags.ts",
	"posthog-activity-state.ts",
];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);
const DEFAULT_SOURCE_DIR = join(PACKAGE_ROOT, "src", "telemetry");
const DEFAULT_COMPONENT_DIR = join(PACKAGE_ROOT, "plugin", "components", "telemetry", "src");

export async function syncTelemetryComponent(options = {}) {
	const sourceDirProvided = options.sourceDir !== undefined;
	const sourceDir = resolve(options.sourceDir ?? DEFAULT_SOURCE_DIR);
	const componentDir = resolve(options.componentDir ?? DEFAULT_COMPONENT_DIR);
	const files = options.files ?? TELEMETRY_SYNC_FILES;
	const check = options.check ?? false;
	const changed = [];

	for (const fileName of files) {
		const sourcePath = join(sourceDir, fileName);
		const componentPath = join(componentDir, fileName);
		const componentText = await readOptionalText(componentPath);
		const sourceText = await readOptionalText(sourcePath);
		if (sourceText === null && !sourceDirProvided) continue;
		if (sourceText === null) {
			await readFile(sourcePath, "utf8");
			continue;
		}
		const nextText = toComponentSource(sourceText);
		if (componentText === nextText) continue;
		changed.push(fileName);
		if (!check) {
			await mkdir(dirname(componentPath), { recursive: true });
			await writeFile(componentPath, nextText);
		}
	}

	if (check && changed.length > 0) {
		throw new Error(`telemetry component out of sync: ${changed.join(", ")}`);
	}

	return { checked: check, changed };
}

function toComponentSource(sourceText) {
	return sourceText
		.replaceAll(/\bprocess\.env\.([A-Z0-9_]+)/g, 'process.env["$1"]')
		.replaceAll(/from "(\.\/[^"]+)"/g, 'from "$1.js"');
}

async function readOptionalText(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return null;
		throw error;
	}
}

function isNodeError(error) {
	return error instanceof Error && "code" in error;
}

function parseArgs(args) {
	const parsed = {
		check: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--check") {
			parsed.check = true;
			continue;
		}
		if (arg === "--source-dir") {
			const value = args[index + 1];
			if (value === undefined) throw new Error("--source-dir requires a value");
			parsed.sourceDir = value;
			index += 1;
			continue;
		}
		if (arg === "--component-dir") {
			const value = args[index + 1];
			if (value === undefined) throw new Error("--component-dir requires a value");
			parsed.componentDir = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return parsed;
}

async function main() {
	const result = await syncTelemetryComponent(parseArgs(process.argv.slice(2)));
	if (result.changed.length === 0) {
		console.log("telemetry component in sync");
		return;
	}
	console.log(`synced telemetry component: ${result.changed.join(", ")}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

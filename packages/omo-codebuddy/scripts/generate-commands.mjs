#!/usr/bin/env node
/**
 * Copies the hand-authored slash commands from `resources/commands/` into the
 * plugin. The sources are tracked markdown; the plugin copy is generated so the
 * shipped plugin always matches this package.
 *
 * Commands are thin wrappers: they load the matching omo skill and forward the
 * user's arguments. `${CODEBUDDY_PLUGIN_ROOT}` is substituted by CodeBuddy, so
 * the wrapper never needs to know where the plugin was installed.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(packageRoot, "resources", "commands");
const targetDir = join(packageRoot, "plugin", "commands");

export async function generateCommands({ check = false } = {}) {
	const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".md")).sort();
	if (files.length === 0) throw new Error("no command sources found");

	if (check) {
		for (const file of files) {
			const expected = await readFile(join(sourceDir, file), "utf8");
			let actual = null;
			try {
				actual = await readFile(join(targetDir, file), "utf8");
			} catch {
				throw new Error(`command copy missing: ${file}`);
			}
			if (actual !== expected) throw new Error(`command copy is stale: ${file}`);
		}
		return { files };
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	for (const file of files) {
		const content = await readFile(join(sourceDir, file), "utf8");
		await writeFile(join(targetDir, file), content, "utf8");
	}
	return { files };
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const { files } = await generateCommands({ check });
	console.log(check ? `command check passed (${files.length})` : `generated ${files.length} commands`);
}

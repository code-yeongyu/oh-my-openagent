import os from "node:os";
import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "./config.ts";

function pathsPointToSameLocation(leftPath: string, rightPath: string): boolean {
	try {
		return realpathSync(leftPath) === realpathSync(rightPath);
	} catch {
		return false;
	}
}

function isWithinOrSamePath(childPath: string, parentPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function migratePathPreservingExisting(oldPath: string, newPath: string, label: string): void {
	if (!existsSync(oldPath)) return;
	if (existsSync(newPath) && pathsPointToSameLocation(oldPath, newPath)) return;

	if (!existsSync(newPath)) {
		try {
			mkdirSync(dirname(newPath), { recursive: true });
			renameSync(oldPath, newPath);
			console.log(chalk.green(`Migrated ${label} ${oldPath} → ${newPath}`));
		} catch {
			return;
		}
		return;
	}

	let entries: string[];
	try {
		entries = readdirSync(oldPath);
	} catch {
		return;
	}

	let movedAny = false;
	for (const entry of entries) {
		const source = join(oldPath, entry);
		const target = join(newPath, entry);
		if (existsSync(target)) continue;
		try {
			renameSync(source, target);
			movedAny = true;
		} catch {}
	}

	if (movedAny) {
		console.log(chalk.green(`Migrated missing ${label} entries ${oldPath} → ${newPath}`));
	}
}

export function migrateLegacySenpiDirs(cwd: string): void {
	if (CONFIG_DIR_NAME === ".pi") return;

	const homeDir = os.homedir();
	const globalNewAgentDir = getAgentDir();
	const globalNewMomDir = join(homeDir, CONFIG_DIR_NAME, "mom");
	const projectNewDir = join(cwd, CONFIG_DIR_NAME);
	const shouldMigrateHomeConfig = isWithinOrSamePath(globalNewAgentDir, join(homeDir, CONFIG_DIR_NAME));

	const moves: Array<readonly [string, string, string]> = [
		[join(cwd, ".pi"), projectNewDir, "project config directory"],
		[join(cwd, CONFIG_DIR_NAME, ".pi"), projectNewDir, "nested project config directory"],
	];

	if (shouldMigrateHomeConfig) {
		moves.unshift(
			[join(homeDir, ".pi", "agent"), globalNewAgentDir, "global agent directory"],
			[join(homeDir, CONFIG_DIR_NAME, ".pi", "agent"), globalNewAgentDir, "nested global agent directory"],
			[join(homeDir, ".pi", "mom"), globalNewMomDir, "global mom directory"],
			[join(homeDir, CONFIG_DIR_NAME, ".pi", "mom"), globalNewMomDir, "nested global mom directory"],
		);
	}

	for (const [oldPath, newPath, label] of moves) {
		migratePathPreservingExisting(oldPath, newPath, label);
	}
}

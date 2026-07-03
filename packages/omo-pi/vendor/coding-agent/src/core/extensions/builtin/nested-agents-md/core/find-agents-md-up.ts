import { constants, promises as fsPromises } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { DEFAULT_FILE_NAMES } from "./types.ts";

export interface FindAgentsMdUpInput {
	startDir: string;
	rootDir: string;
	fileNames?: readonly string[];
}

export async function findAgentsMdUp(input: FindAgentsMdUpInput): Promise<string[]> {
	const fileNames = input.fileNames ?? DEFAULT_FILE_NAMES;
	const collected: string[] = [];
	let current = input.startDir;

	while (true) {
		const isRoot = current === input.rootDir;
		if (!isRoot) {
			for (const name of fileNames) {
				const candidate = join(current, name);
				const exists = await fileExists(candidate);
				if (exists) {
					collected.push(candidate);
					break;
				}
			}
		}
		if (isRoot) break;
		const parent = dirname(current);
		if (parent === current) break;
		if (!isWithinRoot(input.rootDir, parent)) break;
		current = parent;
	}

	return collected.reverse();
}

function isWithinRoot(rootDir: string, candidate: string): boolean {
	const relativePath = relative(rootDir, candidate);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fsPromises.access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

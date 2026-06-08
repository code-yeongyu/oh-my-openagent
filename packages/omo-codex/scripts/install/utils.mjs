import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

export async function exists(path) {
	try {
		await access(path, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

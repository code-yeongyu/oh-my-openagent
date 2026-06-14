import { lstat, readlink, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const RENAME_RETRY_DELAYS_MS = [10, 25, 50];
const RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"]);

export function isRetriableRenameError(error) {
	if (!(error instanceof Error)) return false;
	return RETRIABLE_RENAME_CODES.has(Reflect.get(error, "code"));
}

export async function writeFileAtomic(targetPath, data) {
	const writeTarget = await resolveSymlinkTarget(targetPath);
	const temporaryPath = join(
		dirname(writeTarget),
		`.tmp-${basename(writeTarget)}-${process.pid}-${Date.now()}`,
	);
	await writeFile(temporaryPath, data);
	try {
		await renameWithRetry(temporaryPath, writeTarget);
	} catch (renameError) {
		await unlink(temporaryPath).catch(() => {});
		throw renameError;
	}
}

async function resolveSymlinkTarget(targetPath) {
	let linkStats;
	try {
		linkStats = await lstat(targetPath);
	} catch {
		return targetPath;
	}
	if (!linkStats.isSymbolicLink()) return targetPath;
	try {
		return await realpath(targetPath);
	} catch {
		const linkValue = await readlink(targetPath);
		return isAbsolute(linkValue) ? linkValue : resolve(dirname(targetPath), linkValue);
	}
}

async function renameWithRetry(fromPath, toPath) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await rename(fromPath, toPath);
			return;
		} catch (renameError) {
			if (!isRetriableRenameError(renameError) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
				throw renameError;
			}
			await delay(RENAME_RETRY_DELAYS_MS[attempt]);
		}
	}
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

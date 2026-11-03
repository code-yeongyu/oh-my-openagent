import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";

import {
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "../../fs/resilient";
import { syncJournalDirectory, syncJournalFile } from "../../journal/fsync";

/**
 * The persisted read-only state of a recovered device (#10412 review M3). Recovery writes it before
 * its join can land, and only a rotation that a fresh reload shows stored releases it, so a crash, a
 * throw or a withheld rotation all leave the device unable to write with the recovered epoch's key.
 * It sits next to the trust pin and outlives the process. A hold file that does not parse still
 * holds: the state fails closed. No sync engine reads it yet (the engine must check it before any
 * write, and should derive the same fact from the chain); that is tracked as a follow-up.
 */
export type WriteHold =
	| { readonly held: false }
	| { readonly held: true; readonly credentialId: string | null };

export const WRITE_HOLD_NEXT_STEP =
	"Run recovery again on this device; writes resume once its key rotation is stored.";

const holdPath = (stateDir: string, account: string): string =>
	join(
		stateDir,
		"recovery-hold",
		`${createHash("sha256").update(account, "utf8").digest("base64url")}.json`,
	);

const isMissing = (error: unknown): boolean =>
	error instanceof Error && "code" in error && error.code === "ENOENT";

export const loadWriteHold = async (
	stateDir: string,
	account: string,
): Promise<WriteHold> => {
	let raw: string;
	try {
		raw = await readFile(holdPath(stateDir, account), "utf8");
	} catch (error) {
		if (isMissing(error)) return { held: false };
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { held: true, credentialId: null };
	}
	const credentialId: unknown = Reflect.get(Object(value), "credential_id");
	const sameAccount = Reflect.get(Object(value), "account") === account;
	return {
		held: true,
		credentialId:
			sameAccount && typeof credentialId === "string" ? credentialId : null,
	};
};

/**
 * The topmost missing directory on the way to `stateDir`, or undefined when it exists. It is read
 * before `mkdir`, not from `mkdir`'s return value: an EINTR retry of a `mkdir` whose first attempt
 * created the directories returns undefined, which would skip the parent fsync (#10611 review).
 */
const topmostMissing = async (stateDir: string): Promise<string | undefined> => {
	let missing: string | undefined;
	for (let dir = resolve(stateDir); ; dir = dirname(dir)) {
		try {
			await lstat(dir);
			return missing;
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		missing = dir;
		if (dirname(dir) === dir) return missing;
	}
};

/**
 * The directories to fsync so `stateDir` and its `recovery-hold` entry are durable (#10611): when
 * `stateDir` or an ancestor was missing (`created`, the topmost one), each new entry is fsynced in
 * the directory that holds it, from the parent of `created` down to `stateDir`.
 */
const entriesToSync = (stateDir: string, created: string | undefined): string[] => {
	const state = resolve(stateDir);
	const dirs = [state];
	if (created === undefined) return dirs;
	const top = resolve(created);
	if (state !== top && !state.startsWith(`${top}${sep}`)) return dirs;
	for (let dir = state; dir !== top; dir = dirname(dir)) dirs.unshift(dirname(dir));
	dirs.unshift(dirname(top));
	return dirs;
};

/**
 * Records that writes are held for `account`, mode 0600, durably (#10450): the staged file is
 * fsynced before the rename and the directories after it, so a power loss right after the join
 * cannot lose the hold. Directories the call creates are fsynced into their parents first (#10611).
 */
export const holdWrites = async (
	stateDir: string,
	account: string,
	credentialId: string,
): Promise<void> => {
	const target = holdPath(stateDir, account);
	const dir = join(stateDir, "recovery-hold");
	const created = await topmostMissing(stateDir);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	for (const entry of entriesToSync(stateDir, created))
		await syncJournalDirectory(entry);
	const staging = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	const body = { version: 1, account, credential_id: credentialId };
	try {
		await writeFile(staging, `${JSON.stringify(body)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		await syncJournalFile(staging);
		await rename(staging, target);
	} finally {
		await rm(staging, { force: true });
	}
	await syncJournalDirectory(dir);
};

/** Releases the hold once a rotation is stored and verified; a missing hold is already released. */
export const releaseWriteHold = async (
	stateDir: string,
	account: string,
): Promise<void> => {
	await rm(holdPath(stateDir, account), { force: true });
	await syncJournalDirectory(join(stateDir, "recovery-hold"));
};

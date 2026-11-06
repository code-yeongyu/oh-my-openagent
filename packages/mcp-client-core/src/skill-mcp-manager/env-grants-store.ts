// Vendored from code-yeongyu/senpi@c6317f5971 (senpi#3818, formatting only).
// Source of truth: packages/coding-agent/src/core/extensions/builtin/mcp/env-grants-store.ts.
// This copy stays: omo-opencode consumes it and has no senpi dependency.
// env-grants-store-drift.test.ts fails when it stops matching the pinned senpi store.
/**
 * Shared native/legacy MCP environment grants, with no senpi-internal imports.
 *
 * File: resolveGrantsStorePath(configDir), where engines MUST pass their already
 * resolved agent/config directory. The standalone default is
 * $XDG_CONFIG_HOME/omo/mcp-env-grants.json (else ~/.config/omo/mcp-env-grants.json).
 * Schema: {version:1,generation:number,grants:{[sha256]:{
 *   label:{project:string,skill:string,server:string},names:string[]}}}.
 * Names are sorted and unique. Neither raw declarations nor environment values,
 * change history, or tombstones are stored. declarationDigest hashes canonical
 * JSON of the complete RAW declaration identity supplied by the engine.
 * Identity keys (shared with the legacy plugin): sourcePath (canonical),
 * sourceKind ("sidecar"|"frontmatter"), projectRoot (canonical), serverName,
 * raw (the complete original server object, no defaults/interpolation), and
 * cwdBase (canonical session cwd, the base for resolving a relative cwd).
 * Object keys sort lexicographically; arrays keep order, undefined object
 * fields are omitted, and JSON has no whitespace. Hash: SHA-256 lowercase hex.
 *
 * Writers lock the path, reread and merge, create a private temporary file,
 * fsync it, rename it atomically, and fsync the directory on POSIX. The lock
 * passes its own onCompromised, which never throws (proper-lockfile's default
 * throws from a heartbeat timer): a lost lock is only recorded, every rename
 * attempt first refuses with GrantsLockLostError (code ELOCKLOST) once the lock
 * was lost, and a lost lock is not released. Revocation
 * completes at the durable write; running engines apply it within watch latency
 * (at most the 5-second fallback interval).
 *
 * observe reconciles latest snapshots, not every generation. Its conservative
 * flag requires invalidating ALL live project-policy connections after skipped
 * generations, counter resets/recreation, or read failure. Otherwise callers
 * invalidate identities whose effective granted set differs from their started
 * set. Watching the containing directory survives atomic rename and creation.
 */
import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";

export interface GrantLabel {
	readonly project: string;
	readonly skill: string;
	readonly server: string;
}
export interface DeclarationIdentity {
	readonly sourcePath: string;
	readonly sourceKind: "sidecar" | "frontmatter";
	readonly projectRoot: string;
	readonly serverName: string;
	readonly raw: Readonly<Record<string, unknown>>;
	readonly cwdBase: string;
}
export interface Grant {
	readonly label: GrantLabel;
	readonly names: readonly string[];
}
export interface GrantSnapshot {
	readonly version: 1;
	readonly generation: number;
	readonly grants: Readonly<Record<string, Grant>>;
}
export interface GrantObservation {
	readonly snapshot: GrantSnapshot;
	readonly conservative: boolean;
}
interface StoreState {
	readonly snapshot: GrantSnapshot;
	readonly inode: string | undefined;
	readonly valid: boolean;
}
const empty = (): GrantSnapshot => ({ version: 1, generation: 0, grants: {} });
const namePattern = /^[^=\0]+$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function resolveGrantsStorePath(configDir?: string): string {
	return join(resolve(configDir ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "omo")),
		"mcp-env-grants.json");
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parse(value: unknown): GrantSnapshot | undefined {
	if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.generation) ||
		typeof value.generation !== "number" || value.generation < 0 || !record(value.grants)) return;
	const grants: Record<string, Grant> = {};
	for (const [digest, entry] of Object.entries(value.grants)) {
		if (!digestPattern.test(digest) || !record(entry) || !record(entry.label) || !Array.isArray(entry.names)) return;
		const { project, skill, server } = entry.label;
		if (typeof project !== "string" || typeof skill !== "string" || typeof server !== "string" ||
			!entry.names.every((name): name is string => typeof name === "string" && namePattern.test(name))) return;
		grants[digest] = { label: { project, skill, server }, names: [...new Set(entry.names)].sort() };
	}
	return { version: 1, generation: value.generation, grants };
}
async function state(path: string): Promise<StoreState> {
	try {
		const file = await open(path, "r");
		try {
			const info = await file.stat();
			const snapshot = parse(JSON.parse(await file.readFile("utf8")));
			return { snapshot: snapshot ?? empty(), inode: `${info.dev}:${info.ino}`, valid: snapshot !== undefined };
		} finally { await file.close(); }
	} catch {
		// Missing, corrupt, or unreadable grants never authorize a name.
		return { snapshot: empty(), inode: undefined, valid: false };
	}
}
export async function read(path = resolveGrantsStorePath()): Promise<GrantSnapshot> {
	return (await state(path)).snapshot;
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (record(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
export function declarationDigest(identity: unknown): string {
	return createHash("sha256").update(canonical(identity)).digest("hex");
}
/** The grants lock was lost or reclaimed before the write committed; the write was skipped. */
export class GrantsLockLostError extends Error {
	declare readonly code: "ELOCKLOST";
	constructor(cause: Error) {
		super("MCP grants lock was lost before the write committed; the write was skipped.", { cause });
		this.code = "ELOCKLOST";
		this.name = "GrantsLockLostError";
	}
}
async function update(path: string, mutate: (grants: Record<string, Grant>) => void): Promise<GrantSnapshot> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	let lost: Error | undefined;
	const release = await lockfile.lock(path, {
		realpath: false, stale: 30_000,
		retries: { retries: 100, factor: 1.2, minTimeout: 20, maxTimeout: 200 },
		onCompromised: (error: Error) => { lost ??= error; },
	});
	const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		const previous = await read(path);
		const grants = { ...previous.grants };
		mutate(grants);
		const next: GrantSnapshot = { version: 1, generation: previous.generation + 1, grants };
		if (!Number.isSafeInteger(next.generation)) throw new RangeError("MCP grant generation exhausted");
		const file = await open(temporary, "wx", 0o600);
		try { await file.writeFile(`${JSON.stringify(next)}\n`); await file.sync(); }
		finally { await file.close(); }
		for (let attempt = 0; ; attempt++) {
			try {
				if (lost !== undefined) throw new GrantsLockLostError(lost);
				await rename(temporary, path);
				break;
			} catch (error) {
				// Windows readers (including antivirus) can temporarily deny replacement.
				if (
					process.platform !== "win32" ||
					!record(error) ||
					!["EPERM", "EACCES", "EBUSY"].includes(String(error.code)) ||
					attempt >= 5
				)
					throw error;
				await delay(50 * 2 ** attempt);
			}
		}
		if (process.platform !== "win32") {
			const directory = await open(dirname(path), "r");
			try { await directory.sync(); } finally { await directory.close(); }
		}
		return next;
	} finally {
		try { await rm(temporary, { force: true }); }
		finally { if (lost === undefined) await release(); }
	}
}
export function addGrant(path: string, digest: string, label: GrantLabel, names: readonly string[]): Promise<GrantSnapshot> {
	if (!digestPattern.test(digest) || names.some((name) => !namePattern.test(name))) {
		return Promise.reject(new TypeError("Invalid MCP grant identity or variable name"));
	}
	return update(path, (grants) => {
		grants[digest] = { label, names: [...new Set([...(grants[digest]?.names ?? []), ...names])].sort() };
	});
}
export function revoke(path: string, digest: string, names?: readonly string[]): Promise<GrantSnapshot> {
	return update(path, (grants) => {
		const entry = grants[digest];
		if (!entry) return;
		const remaining = names === undefined ? [] : entry.names.filter((name) => !names.includes(name));
		if (remaining.length === 0) delete grants[digest];
		else grants[digest] = { ...entry, names: remaining };
	});
}
export async function list(path = resolveGrantsStorePath()): Promise<readonly (Grant & { readonly digest: string })[]> {
	return Object.entries((await read(path)).grants).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([digest, grant]) => ({ digest, ...grant }));
}
export async function observe(path: string, listener: (event: GrantObservation) => void): Promise<() => void> {
	let previous = await state(path);
	let closed = false;
	let watcher: FSWatcher | undefined;
	let watchedDirectory: string | undefined;
	let queue = Promise.resolve();
	const arm = async () => {
		let directory = dirname(path);
		for (;;) {
			try { if ((await stat(directory)).isDirectory()) break; }
			catch { /* Watch the closest existing ancestor until the config directory appears. */ }
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		if (closed || (directory === watchedDirectory && watcher !== undefined)) return;
		watcher?.close();
		watchedDirectory = directory;
		try {
			watcher = watch(directory, { persistent: false }, () => enqueue());
			watcher.on("error", () => { watcher?.close(); watcher = undefined; });
		} catch { watcher = undefined; } // The mandatory poll also covers unavailable fs.watch.
	};
	const reconcile = async () => {
		if (closed) return;
		await arm();
		const current = await state(path);
		if (closed) return;
		if (current.valid === previous.valid && current.inode === previous.inode &&
			declarationDigest(current.snapshot) === declarationDigest(previous.snapshot)) return;
		const conservative = !current.valid ||
			current.snapshot.generation > previous.snapshot.generation + 1 ||
			current.snapshot.generation < previous.snapshot.generation ||
			(current.inode !== previous.inode && current.snapshot.generation <= previous.snapshot.generation);
		previous = current;
		listener({ snapshot: current.snapshot, conservative });
	};
	const enqueue = () => { queue = queue.then(reconcile, reconcile); };
	await arm();
	listener({ snapshot: previous.snapshot, conservative: false });
	await reconcile(); // Covers creation/replacement between the initial read and watch registration.
	const timer = setInterval(enqueue, 5_000);
	timer.unref();
	return () => { closed = true; watcher?.close(); clearInterval(timer); };
}

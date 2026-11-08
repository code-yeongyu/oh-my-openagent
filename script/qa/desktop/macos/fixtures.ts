import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { command, jxa } from "./observer.ts";

const SETTLE_DEADLINE_MS = 60_000;

/**
 * Subscribe before probing. A disk-backed condition wakes on its file's change;
 * OS accessibility/LaunchServices state has no notification here, so a failed
 * probe triggers a bounded, progressively spaced recheck instead.
 */
export async function settle<T>(
	what: string,
	probe: () => Promise<T>,
	reached: (value: T) => boolean,
	deadlineMs = SETTLE_DEADLINE_MS,
	watchPath?: string,
): Promise<T> {
	const deadline = Date.now() + deadlineMs;
	const watcher = watchPath === undefined ? undefined : watch(dirname(watchPath));
	const watchedName = watchPath === undefined ? undefined : basename(watchPath);
	let changed = false;
	let wake: (() => void) | undefined;
	watcher?.on("change", (_event, filename) => {
		if (filename !== null && filename !== undefined && filename.toString() !== watchedName) return;
		changed = true;
		wake?.();
	});
	let delay = 16;
	try {
		for (;;) {
			changed = false;
			const value = await probe();
			if (reached(value)) return value;
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw new Error(`${what} not reached; last=${JSON.stringify(value)}`);
			if (changed) continue;
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, watchPath === undefined ? Math.min(remaining, delay) : remaining);
				wake = () => { clearTimeout(timer); resolve(); };
				if (changed) wake();
			});
			wake = undefined;
			if (watchPath === undefined) delay = Math.min(delay * 2, 500);
		}
	} finally {
		watcher?.close();
	}
}

export const workDir = mkdtempSync(join(tmpdir(), "omo-qa-desktop-fixtures-"));

async function textEditDocuments(): Promise<readonly string[]> {
	const names = await jxa(`const t = Application('TextEdit'); JSON.stringify(t.running() ? t.documents.name() : [])`);
	return Array.isArray(names) ? names.map(String) : [];
}

const textEditRunning = async () =>
	(await command("/usr/bin/lsappinfo", ["find", "bundleid=com.apple.TextEdit"])).length > 0;

const opened = new Set<string>();

/** Reset TextEdit without touching any user's saved defaults. */
export async function quitTextEdit(): Promise<void> {
	opened.clear();
	// pkill exits 1 if absent; LaunchServices independently confirms the result.
	await command("/usr/bin/pkill", ["-9", "-x", "TextEdit"]).catch(() => "");
	await settle("TextEdit ended", textEditRunning, (running) => !running);
}

export async function openTextEdit(name: string, text: string): Promise<string> {
	const path = join(workDir, name);
	writeFileSync(path, text);
	await command("/usr/bin/open", [
		"-g", "-F", "-a", "TextEdit", path, "--args", "-ApplePersistenceIgnoreState", "YES",
	]);
	opened.add(name);
	const names = await settle(`TextEdit opened ${name}`, textEditDocuments, (docs) => docs.includes(name));
	const strays = names.filter((doc) => !opened.has(doc));
	if (strays.length > 0) throw new Error(`TextEdit shows documents the driver did not open: ${strays.join(", ")}`);
	return name;
}

export async function textEditText(name: string): Promise<string> {
	return String(await jxa(`JSON.stringify(Application('TextEdit').documents.byName(${JSON.stringify(name)}).text())`));
}

export async function textEditSelection(name: string): Promise<unknown> {
	return jxa(`
const w = Application('System Events').processes.byName('TextEdit').windows.byName(${JSON.stringify(name)});
JSON.stringify(w.scrollAreas[0].textAreas[0].attributes.byName('AXSelectedTextRange').value());`);
}

export interface KeySink {
	readonly path: string;
	readonly tty: string;
	readonly windowId: number;
	read(): string;
}

const sinkWindow = (windowId: number) => `Application('Terminal').windows.byId(${windowId})`;
const sinkBusy = async (windowId: number) =>
	(await jxa(`JSON.stringify(${sinkWindow(windowId)}.tabs[0].busy())`)) === true;

export async function openKeySink(label: string): Promise<KeySink> {
	const path = join(workDir, `${label}-sink.txt`);
	writeFileSync(path, "");
	const tty = await jxa(`
const t = Application('Terminal');
const tab = t.doScript(${JSON.stringify(`head -n 1 > '${path}'; exit`)});
t.activate();
JSON.stringify(tab.tty());`);
	const windowId = await settle(
		"key sink window",
		async () => Number(await jxa(`
const tty = ${JSON.stringify(tty)};
const found = Application('Terminal').windows().find((w) => w.tabs().some((c) => c.tty() === tty && c.busy()));
JSON.stringify(found === undefined ? 0 : found.id());`)),
		(id) => id > 0,
	);
	await jxa(`const t = Application('Terminal'); t.activate(); t.windows.byId(${windowId}).index = 1; '"ok"';`);
	await settle(
		"key sink focused",
		() => jxa(`const t = Application('Terminal');
JSON.stringify(Application('System Events').processes.whose({ frontmost: true })[0].name() === 'Terminal' ? t.windows[0].id() : 0);`),
		(id) => id === windowId,
	);
	return { path, tty: String(tty).replace("/dev/", ""), windowId, read: () => readFileSync(path, "utf8") };
}

export async function closeKeySink(sink: KeySink): Promise<void> {
	if (await sinkBusy(sink.windowId)) {
		const listed = await command("/bin/ps", ["-t", sink.tty, "-o", "pid=,comm="]);
		const heads = listed.split("\n").flatMap((line) => {
			const [pid, comm] = line.trim().split(/\s+/);
			return comm === "head" && pid !== undefined ? [pid] : [];
		});
		if (heads.length > 0) await command("/bin/kill", heads);
	}
	await settle("key sink shell exited", () => sinkBusy(sink.windowId), (busy) => !busy);
	await jxa(`${sinkWindow(sink.windowId)}.close(); '"ok"'`);
}

export interface DialogCounter {
	stop(): Promise<readonly number[]>;
}

const COUNT_DIALOGS = (stopFile: string) => `
ObjC.import('Foundation');
const se = Application('System Events');
const others = se.processes.whose({ _and: [{ name: 'osascript' }, { _not: [{ unixId: $.NSProcessInfo.processInfo.processIdentifier }] }] });
const seen = {};
console.log('ready');
while (!$.NSFileManager.defaultManager.fileExistsAtPath(${JSON.stringify(stopFile)})) {
	try {
		const pids = others.unixId();
		const texts = others.windows.staticTexts.value();
		pids.forEach((pid, index) => {
			if (JSON.stringify(texts[index] || []).includes('senpi desktop canary')) seen[pid] = true;
		});
	} catch (error) {
		// The dialog can close between queries; a subsequent pass sees the stable list.
	}
}
JSON.stringify(Object.keys(seen).map(Number));
`;

export async function countCanaryDialogs(): Promise<DialogCounter> {
	const stopFile = join(workDir, `canary-stop-${Date.now()}`);
	const child: ChildProcess = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", COUNT_DIALOGS(stopFile)]);
	let stdout = "";
	child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
	const exited = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`canary dialog counter exited ${code}`));
		});
	});
	let readyTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			new Promise<void>((resolve, reject) => {
				child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
					if (chunk.includes("ready")) resolve();
				});
				child.once("close", () => reject(new Error("canary dialog counter exited before it was ready")));
			}),
			new Promise<never>((_, reject) => {
				readyTimer = setTimeout(() => reject(new Error("canary dialog counter readiness deadline exceeded")), SETTLE_DEADLINE_MS);
			}),
		]);
	} catch (error) {
		child.kill("SIGKILL");
		throw error;
	} finally {
		if (readyTimer !== undefined) clearTimeout(readyTimer);
	}
	return {
		async stop() {
			writeFileSync(stopFile, "");
			const timer = setTimeout(() => child.kill("SIGKILL"), SETTLE_DEADLINE_MS);
			try {
				await exited;
			} finally {
				clearTimeout(timer);
			}
			const pids: unknown = JSON.parse(stdout.trim());
			return Array.isArray(pids) ? pids.map(Number) : [];
		},
	};
}

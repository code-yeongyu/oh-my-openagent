// User-level tool provisioning on a Debian host: `apt-get download` the packages the scenarios need
// that the host lacks, and `dpkg-deb -x` them under `<workdir>/root`. Nothing is installed system-wide.
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { exists, type Processes } from "./procs.ts";

/** xterm + xclip for the X11 targets and their paste observer, sway for the headless Wayland
 * compositor, systemd for `busctl`. */
export const PACKAGES: readonly string[] = ["xterm", "xclip", "sway", "systemd"];
const BINARIES: readonly string[] = ["xterm", "xclip", "sway", "busctl"];

export const X11_TOOLS: readonly string[] = ["Xvfb", "xfwm4", "xprop", "xwininfo", "xdotool", "xterm", "xclip"];
export const WAYLAND_TOOLS: readonly string[] = ["dbus-daemon", "sway", "busctl"];

export function multiarch(): string {
	switch (process.arch) {
		case "x64":
			return "x86_64-linux-gnu";
		case "arm64":
			return "aarch64-linux-gnu";
		default:
			throw new Error(`unsupported architecture ${process.arch}`);
	}
}

export function toolEnv(root: string, base: NodeJS.ProcessEnv): Record<string, string> {
	const lib = join(root, "usr/lib", multiarch());
	return {
		PATH: [join(root, "usr/bin"), join(root, "usr/sbin"), base.PATH ?? "/usr/bin:/bin"].join(":"),
		LD_LIBRARY_PATH: [lib, join(lib, "systemd"), join(lib, "elogind"), base.LD_LIBRARY_PATH ?? ""]
			.filter((p) => p !== "")
			.join(":"),
		XFILESEARCHPATH: `${join(root, "etc/X11/%T/%N%C%S")}:${join(root, "etc/X11/%T/%N%S")}:/etc/X11/%T/%N%S`,
	};
}

export async function which(procs: Processes, binary: string): Promise<string | undefined> {
	const found = await procs.run(["sh", "-c", 'command -v "$1"', "which", binary]);
	const path = found.stdout.trim();
	return found.code === 0 && path !== "" ? path : undefined;
}

export async function requireTools(procs: Processes, stage: string, tools: readonly string[]): Promise<void> {
	const missing: string[] = [];
	for (const tool of tools) {
		if ((await which(procs, tool)) === undefined) missing.push(tool);
	}
	if (missing.length > 0) {
		throw new Error(`${stage} stage needs ${missing.join(", ")} on PATH (install them or pass --provision)`);
	}
}

async function missingPackages(procs: Processes): Promise<string[]> {
	const depends = await procs.run([
		"apt-cache",
		"depends",
		"--recurse",
		"--no-recommends",
		"--no-suggests",
		"--no-conflicts",
		"--no-breaks",
		"--no-replaces",
		"--no-enhances",
		...PACKAGES,
	]);
	if (depends.code !== 0) throw new Error(`apt-cache depends: ${depends.stderr.trim()}`);
	const names = [...new Set(depends.stdout.split("\n").filter((line) => /^[a-z0-9]/.test(line)))].map((n) =>
		n.trim(),
	);
	const status = await procs.run(["dpkg-query", "-W", "-f=${Package} ${db:Status-Abbrev}\n", ...names]);
	const installed = new Set(
		status.stdout
			.split("\n")
			.filter((line) => /^\S+ ii/.test(line))
			.map((line) => line.split(" ")[0]),
	);
	return names.filter((name) => !installed.has(name));
}

/** Provisions `root`; returns log lines. Idempotent: a tree that already has every binary is kept. */
export async function provision(procs: Processes, workdir: string): Promise<string[]> {
	const root = join(workdir, "root");
	const debs = join(workdir, "debs");
	if (BINARIES.every((binary) => exists(join(root, "usr/bin", binary)))) {
		return [`provision: ${root} already has ${BINARIES.join(", ")}`];
	}
	mkdirSync(debs, { recursive: true });
	mkdirSync(root, { recursive: true });
	const missing = await missingPackages(procs);
	const log = [`provision: ${missing.length} packages missing on the host: ${missing.join(" ")}`];
	const fetched = readdirSync(debs);
	for (const name of missing.filter((pkg) => !fetched.some((deb) => deb.startsWith(`${pkg}_`)))) {
		// The mirror answers transient 502s that apt's own retry does not cover: three attempts.
		for (let attempt = 1; attempt <= 3; attempt++) {
			const downloaded = await procs.run(["sh", "-c", 'cd "$1" && apt-get -o Acquire::Retries=3 download "$2"', "download", debs, name]);
			if (downloaded.code === 0) break;
			log.push(`provision: download ${name} attempt ${attempt} failed: ${downloaded.stderr.trim()}`);
		}
	}
	for (const deb of readdirSync(debs).filter((file) => file.endsWith(".deb"))) {
		const extracted = await procs.run(["dpkg-deb", "-x", join(debs, deb), root]);
		if (extracted.code !== 0) log.push(`provision: extract ${deb} failed: ${extracted.stderr.trim()}`);
	}
	const missingBinaries: string[] = [];
	for (const binary of BINARIES) {
		const path = await which(procs, binary);
		if (path === undefined) missingBinaries.push(binary);
		log.push(`provision: ${binary} -> ${path ?? "MISSING"}`);
	}
	if (missingBinaries.length > 0) {
		throw new Error(`provision left ${missingBinaries.join(", ")} missing:\n${log.join("\n")}`);
	}
	return log;
}

// The Wayland stage: a private session bus (whatever it carries is probed, never assumed) and
// `sway --headless` on the pixman renderer. Probes are OS-level: the socket file and `busctl --user`.
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { exists, type Processes, until } from "./procs.ts";
import { requireTools, WAYLAND_TOOLS } from "./provision.ts";

export const PORTAL_NAME = "org.freedesktop.portal.Desktop";
export const A11Y_NAME = "org.a11y.Bus";

export interface WaylandStage {
	readonly socket: string;
	readonly env: Record<string, string | undefined>;
}

export class WaylandObserver {
	constructor(
		private readonly procs: Processes,
		private readonly stage: WaylandStage,
	) {}

	socketPresent(): boolean {
		return exists(this.stage.socket);
	}

	async busName(name: string): Promise<{ present: boolean; exit: number | null }> {
		const status = await this.procs.run(["busctl", "--user", "--no-pager", "status", name], this.stage.env);
		return { present: status.code === 0, exit: status.code };
	}

	async busNames(): Promise<string[]> {
		const listed = await this.procs.run(["busctl", "--user", "--no-pager", "--acquired", "list"], this.stage.env);
		if (listed.code !== 0) throw new Error(`busctl --user list exited ${listed.code}: ${listed.stderr.trim()}`);
		return listed.stdout
			.split("\n")
			.slice(1)
			.map((line) => line.split(/\s+/)[0] ?? "")
			.filter((name) => name !== "");
	}
}

export async function startWayland(
	procs: Processes,
	runDir: string,
): Promise<{ stage: WaylandStage; observe: WaylandObserver }> {
	await requireTools(procs, "wayland", WAYLAND_TOOLS);
	const runtime = join(runDir, "xdg");
	mkdirSync(runtime, { recursive: true });
	chmodSync(runtime, 0o700);
	const bus = join(runDir, "session-bus");
	procs.start("dbus-daemon", [
		"dbus-daemon",
		"--session",
		"--nofork",
		"--nopidfile",
		`--address=unix:path=${bus}`,
	]);
	await until(() => exists(bus), "the private session bus");
	const config = join(runDir, "sway.cfg");
	writeFileSync(config, "xwayland disable\n");
	const base = {
		XDG_RUNTIME_DIR: runtime,
		DBUS_SESSION_BUS_ADDRESS: `unix:path=${bus}`,
		DISPLAY: undefined,
		WAYLAND_DISPLAY: undefined,
		LIBEI_SOCKET: undefined,
	};
	procs.start("sway --headless", ["sway", "-c", config], {
		...base,
		WLR_BACKENDS: "headless",
		WLR_RENDERER: "pixman",
		WLR_LIBINPUT_NO_DEVICES: "1",
	});
	let display = "";
	await until(() => {
		display = readdirSync(runtime).find((entry) => /^wayland-\d+$/.test(entry)) ?? "";
		return display !== "";
	}, "sway to create its Wayland socket");
	const stage = { socket: join(runtime, display), env: { ...base, WAYLAND_DISPLAY: display } };
	return { stage, observe: new WaylandObserver(procs, stage) };
}

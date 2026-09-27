// The X11 stage: Xvfb, the xfwm4 window manager (EWMH, publishes `_NET_ACTIVE_WINDOW`), a target
// xterm whose shell records every line pasted into it, a second xterm to hold focus, and `xclip`
// owning the PRIMARY selection. Every read here is an independent process (xprop, xwininfo,
// xdotool, the target xterm's own shell), never the engine.
//
// The target needs `allowSendEvents` so background `XSendEvent` input is accepted, and xterm then
// forces mouse tracking and title ops off. So a click is observed as a middle-button paste: xterm
// inserts PRIMARY on Btn2 release, and the shell's `read` counts the pasted line.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { exists, type Processes, until } from "./procs.ts";
import { requireTools, X11_TOOLS } from "./provision.ts";

const TARGET_TITLE = "qa-target";
const OTHER_TITLE = "qa-other";
export const PASTE_TOKEN = "omo-qa-paste";

const TARGET_SCRIPT = `stty -echo
n=0
printf '%d\\n' "$n" > "$1"
while IFS= read -r line; do
	n=$((n + 1))
	printf '%d %s\\n' "$n" "$line" > "$1"
done
`;

// The focus holder only has to stay mapped; it blocks on its own tty until teardown stops its group.
const HOLDER_SCRIPT = "stty -echo; while IFS= read -r _; do :; done";

export interface X11Stage {
	readonly display: string;
	readonly target: string;
	readonly other: string;
	readonly env: Record<string, string | undefined>;
}

export type Pastes = { readonly count: number; readonly last: string };

function freeDisplay(): number {
	for (let display = 140; display < 240; display++) {
		if (!exists(`/tmp/.X11-unix/X${display}`) && !exists(`/tmp/.X${display}-lock`)) return display;
	}
	throw new Error("no free X display number in 140..239");
}

export class X11Observer {
	constructor(
		private readonly procs: Processes,
		private readonly env: Record<string, string | undefined>,
		private readonly pastesFile: string,
	) {}

	private async stdout(argv: readonly string[]): Promise<string> {
		const ran = await this.procs.run(argv, this.env);
		if (ran.code !== 0) throw new Error(`${argv.join(" ")} exited ${ran.code}: ${ran.stderr.trim()}`);
		return ran.stdout.trim();
	}

	/** `_NET_ACTIVE_WINDOW` as a decimal XID, read by `xprop -root`. */
	async activeWindow(): Promise<string> {
		const line = await this.stdout(["xprop", "-root", "_NET_ACTIVE_WINDOW"]);
		const hex = /window id # (0x[0-9a-f]+)/i.exec(line)?.[1];
		if (hex === undefined) throw new Error(`no _NET_ACTIVE_WINDOW: ${line}`);
		return String(Number.parseInt(hex, 16));
	}

	/** What the target xterm's shell recorded; count -1 before it started. */
	pastes(): Pastes {
		try {
			const match = /^(\d+) ?(.*)$/.exec(readFileSync(this.pastesFile, "utf8").trim());
			return match === null ? { count: -1, last: "" } : { count: Number(match[1]), last: match[2] ?? "" };
		} catch {
			return { count: -1, last: "" };
		}
	}

	async pastesAbove(baseline: number): Promise<Pastes> {
		let seen = this.pastes();
		await until(() => {
			seen = this.pastes();
			return seen.count > baseline;
		}, `pastes above ${baseline}`);
		return seen;
	}

	async geometry(window: string): Promise<{ width: number; height: number }> {
		const info = await this.stdout(["xwininfo", "-id", window]);
		const width = Number(/Width: (\d+)/.exec(info)?.[1] ?? -1);
		const height = Number(/Height: (\d+)/.exec(info)?.[1] ?? -1);
		return { width, height };
	}

	async activate(window: string): Promise<void> {
		await this.stdout(["xdotool", "windowactivate", "--sync", window]);
		await until(async () => (await this.activeWindow()) === window, `window ${window} to become active`);
	}

	async find(title: string): Promise<string> {
		let found = "";
		await until(async () => {
			const ran = await this.procs.run(["xdotool", "search", "--name", `^${title}$`], this.env);
			found = ran.stdout.trim().split("\n")[0] ?? "";
			return ran.code === 0 && found !== "";
		}, `a window titled ${title}`);
		return found;
	}

	async primarySelection(): Promise<string> {
		return this.stdout(["xclip", "-o", "-selection", "primary"]);
	}
}

export async function startX11(procs: Processes, runDir: string): Promise<{ stage: X11Stage; observe: X11Observer }> {
	await requireTools(procs, "x11", X11_TOOLS);
	const number = freeDisplay();
	const display = `:${number}`;
	const env = { DISPLAY: display, WAYLAND_DISPLAY: undefined };
	procs.start("Xvfb", ["Xvfb", display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], env);
	await until(() => exists(`/tmp/.X11-unix/X${number}`), `Xvfb ${display}`);
	const pastesFile = join(runDir, "target-pastes");
	const observe = new X11Observer(procs, env, pastesFile);
	procs.start("xfwm4", ["xfwm4", "--compositor=off", "--sm-client-disable"], env);
	await until(async () => {
		const check = await procs.run(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"], env);
		return check.code === 0 && /window id #/.test(check.stdout);
	}, "xfwm4 to publish EWMH");
	const token = join(runDir, "paste-token");
	writeFileSync(token, `${PASTE_TOKEN}\n`);
	procs.start("xclip PRIMARY owner", ["xclip", "-quiet", "-loops", "0", "-selection", "primary", "-i", token], env);
	await until(async () => (await observe.primarySelection().catch(() => "")) === PASTE_TOKEN, "xclip to own PRIMARY");
	const script = join(runDir, "target-xterm.sh");
	writeFileSync(script, TARGET_SCRIPT);
	const allowSendEvents = ["-xrm", "XTerm*allowSendEvents: true"];
	const target = ["-T", TARGET_TITLE, ...allowSendEvents, "-geometry", "60x12+40+40", "-e", "sh", script, pastesFile];
	const other = ["-T", OTHER_TITLE, "-geometry", "40x8+700+420", "-e", "sh", "-c", HOLDER_SCRIPT];
	const xterms = [procs.start("xterm target", ["xterm", ...target], env), procs.start("xterm other", ["xterm", ...other], env)];
	const windows = await Promise.all([observe.find(TARGET_TITLE), observe.find(OTHER_TITLE)]).catch((error) => {
		const output = xterms.map((xterm) => `pid ${xterm.pid} exit ${xterm.exitCode}: ${procs.output(xterm)}`);
		throw new Error(`${error instanceof Error ? error.message : String(error)}; xterm output: ${output.join(" | ")}`);
	});
	const [targetWindow, otherWindow] = windows;
	await until(() => observe.pastes().count === 0, "the target xterm script to start");
	return { stage: { display, target: targetWindow, other: otherWindow, env }, observe };
}

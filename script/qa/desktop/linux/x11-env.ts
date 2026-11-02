// The X11 stage: Xvfb, the xfwm4 window manager (EWMH, publishes `_NET_ACTIVE_WINDOW`), a target
// xterm whose shell records every line pasted into it, a second xterm to hold focus, a Tk text
// widget that records its own view for the scroll-direction scenarios, and `xclip` owning the
// PRIMARY selection. Every read here is an independent process (xprop, xwininfo,
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
const SCROLL_TITLE = "qa-scroll";
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

// A long, wide, read-only document opened mid-content both ways. Every view change, and every
// pointer motion into or inside the widget, rewrites the report file (atomically) with the text
// index at the view's top-left pixel, the widget's own line height in pixels (0 until measured), the
// root point of the last pointer motion it handled, and its own root origin:
// `<line>.<column> <lineHeight> <markX>,<markY> <originX>,<originY>`. X delivers a client's events
// in order, so once a pointer motion sent after a scroll shows up as the mark, the view reported
// with it includes every wheel click queued before it.
const SCROLL_SCRIPT = `set report [lindex $argv 0]
set lineHeight 0
set mark 0,0
set origin 0,0
wm title . ${SCROLL_TITLE}
wm geometry . +40+300
text .t -wrap none -width 40 -height 10 -yscrollcommand record -xscrollcommand record
pack .t -fill both -expand 1
for {set i 1} {$i <= 200} {incr i} {
	.t insert end [format "line %03d %s\\n" $i [string repeat . 160]]
}
.t configure -state disabled
# Tk 8.6 binds only buttons 4/5; 6/7 scroll left/right in the X11 wheel convention GTK and Qt follow.
bind .t <6> {%W xview scroll -4 units}
bind .t <7> {%W xview scroll 4 units}
bind .t <Motion> {set mark %X,%Y; record}
bind .t <Enter> {set mark %X,%Y; record}
proc record args {
	global report lineHeight mark origin
	set f [open $report.tmp w]
	puts $f "[.t index @0,0] $lineHeight $mark $origin"
	close $f
	file rename -force $report.tmp $report
}
.t yview scroll 100 units
.t xview scroll 40 units
update
# The height of the display line at the top of the view, as laid out by the widget itself.
set lineHeight [lindex [.t dlineinfo @0,0] 3]
set origin [winfo rootx .t],[winfo rooty .t]
record
`;

export interface X11Stage {
	readonly display: string;
	readonly target: string;
	readonly other: string;
	readonly scroll: string;
	readonly env: Record<string, string | undefined>;
}

export type Pastes = { readonly count: number; readonly last: string };
type RootPoint = { readonly x: number; readonly y: number };
/**
 * The scroll fixture's top-left text index, line height in pixels, the root point of the last
 * pointer motion it handled, and its widget's root origin; zeros before it reported.
 */
export type ScrollView = {
	readonly line: number;
	readonly column: number;
	readonly lineHeight: number;
	readonly mark: RootPoint;
	readonly origin: RootPoint;
};
const NO_SCROLL_VIEW: ScrollView = { line: 0, column: 0, lineHeight: 0, mark: { x: 0, y: 0 }, origin: { x: 0, y: 0 } };

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
		private readonly scrollFile: string,
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

	/** What the scroll fixture reported about its own view. */
	scrollView(): ScrollView {
		try {
			const report = readFileSync(this.scrollFile, "utf8").trim();
			const match = /^(\d+)\.(\d+) (\d+) (-?\d+),(-?\d+) (-?\d+),(-?\d+)$/.exec(report);
			if (match === null) return NO_SCROLL_VIEW;
			const [line, column, lineHeight, markX, markY, originX, originY] = match.slice(1).map(Number);
			return {
				line: line ?? 0,
				column: column ?? 0,
				lineHeight: lineHeight ?? 0,
				mark: { x: markX ?? 0, y: markY ?? 0 },
				origin: { x: originX ?? 0, y: originY ?? 0 },
			};
		} catch {
			return NO_SCROLL_VIEW;
		}
	}

	/**
	 * Moves the pointer to `marker` (a root point inside the scroll fixture that differs from its last
	 * mark) and returns the view the fixture reported with that motion: every wheel event queued
	 * before the motion is already applied to it. The last report when the hang guard expires first.
	 */
	async scrollViewAfter(marker: RootPoint): Promise<ScrollView> {
		await this.stdout(["xdotool", "mousemove", String(marker.x), String(marker.y)]);
		const marked = (): boolean => {
			const { mark } = this.scrollView();
			return mark.x === marker.x && mark.y === marker.y;
		};
		await until(marked, "the scroll fixture to report the marker motion").catch(() => undefined);
		return this.scrollView();
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
	const scrollFile = join(runDir, "scroll-view");
	const observe = new X11Observer(procs, env, pastesFile, scrollFile);
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
	const scrollScript = join(runDir, "scroll-fixture.tcl");
	writeFileSync(scrollScript, SCROLL_SCRIPT);
	const clients = [
		procs.start("xterm target", ["xterm", ...target], env),
		procs.start("xterm other", ["xterm", ...other], env),
		procs.start("wish scroll fixture", ["wish", scrollScript, scrollFile], env),
	];
	const titles = [TARGET_TITLE, OTHER_TITLE, SCROLL_TITLE];
	const windows = await Promise.all(titles.map((title) => observe.find(title))).catch((error) => {
		const output = clients.map((client) => `pid ${client.pid} exit ${client.exitCode}: ${procs.output(client)}`);
		throw new Error(`${error instanceof Error ? error.message : String(error)}; client output: ${output.join(" | ")}`);
	});
	const [targetWindow = "", otherWindow = "", scrollWindow = ""] = windows;
	await until(() => observe.pastes().count === 0, "the target xterm script to start");
	await until(() => {
		const view = observe.scrollView();
		return view.line > 0 && view.lineHeight > 0;
	}, "the scroll fixture to report its view and line height");
	return { stage: { display, target: targetWindow, other: otherWindow, scroll: scrollWindow, env }, observe };
}

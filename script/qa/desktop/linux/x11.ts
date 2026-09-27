// X11 scenarios: capture + click into the target xterm, the foreground focus guard, background
// `XSendEvent` delivery that leaves `_NET_ACTIVE_WINDOW` alone, and the XI2 stop chord latch.
import { asObject, Engine, type Json, type JsonObject, outcome } from "./engine.ts";
import { until } from "./procs.ts";
import { type Context, type Result, result } from "./scenario.ts";
import { PASTE_TOKEN, type X11Observer, type X11Stage } from "./x11-env.ts";

const PNG_SIGNATURE = "89504e470d0a1a0a";

interface Png {
	readonly bytes: number;
	readonly signature: boolean;
	readonly width: number;
	readonly height: number;
}

function png(base64: Json | undefined): Png {
	const data = Buffer.from(typeof base64 === "string" ? base64 : "", "base64");
	const signature = data.subarray(0, 8).toString("hex") === PNG_SIGNATURE;
	const width = data.length >= 24 ? data.readUInt32BE(16) : -1;
	const height = data.length >= 24 ? data.readUInt32BE(20) : -1;
	return { bytes: data.length, signature, width, height };
}

async function engineFor(ctx: Context, stage: X11Stage): Promise<{ engine: Engine; stop: JsonObject }> {
	const engine = Engine.spawn(ctx.engineBinary, ctx.procs.childEnv(stage.env));
	const stop = await engine.activate(false);
	return { engine, stop };
}

async function captureTarget(engine: Engine, stage: X11Stage): Promise<JsonObject> {
	return asObject(await engine.result("capture", { target: stage.target }));
}

/** A middle-button click (xterm pastes PRIMARY) at the centre of the target's latest frame. */
function clickParams(stage: X11Stage, frame: JsonObject, deliveryMode?: string): JsonObject {
	return {
		target: stage.target,
		x: Math.floor(Number(frame.width) / 2),
		y: Math.floor(Number(frame.height) / 2),
		frameId: frame.frameId ?? null,
		opts: deliveryMode === undefined ? { button: "middle" } : { button: "middle", deliveryMode },
	};
}

async function captureClick(ctx: Context, stage: X11Stage, observe: X11Observer): Promise<Result> {
	const { engine, stop } = await engineFor(ctx, stage);
	try {
		const frame = await captureTarget(engine, stage);
		const image = png(frame.data);
		const geometry = await observe.geometry(stage.target);
		const before = observe.pastes();
		const click = outcome(await engine.exec("click", clickParams(stage, frame)));
		const after = click === "ok" ? await observe.pastesAbove(before.count) : observe.pastes();
		return result(
			"x11-capture-click-xterm",
			{
				png_signature: image.signature,
				png_size_matches_xwininfo: image.width === geometry.width && image.height === geometry.height,
				click_ok: click === "ok",
				xterm_received_click: after.count === before.count + 1 && after.last === PASTE_TOKEN,
			},
			{ display: stage.display, stopPath: stop, png: { ...image }, xwininfo: geometry, click, mode: String(frame.mode) },
			{ before, after },
		);
	} finally {
		await engine.close();
	}
}

async function deliveredClick(
	ctx: Context,
	stage: X11Stage,
	observe: X11Observer,
	deliveryMode: "foreground" | "background",
): Promise<Result> {
	const { engine } = await engineFor(ctx, stage);
	try {
		await observe.activate(stage.other);
		const frame = await captureTarget(engine, stage);
		const before = { active: await observe.activeWindow(), ...observe.pastes() };
		const click = outcome(await engine.exec("click", clickParams(stage, frame, deliveryMode)));
		const pasted = click === "ok" ? await observe.pastesAbove(before.count) : observe.pastes();
		const after = { active: await observe.activeWindow(), ...pasted };
		const name = deliveryMode === "foreground" ? "x11-focus-guard" : "x11-background-keeps-active-window";
		return result(
			name,
			{
				other_active_before: before.active === stage.other,
				click_ok: click === "ok",
				target_received_click: after.count === before.count + 1 && after.last === PASTE_TOKEN,
				active_window_restored: after.active === before.active,
			},
			{ display: stage.display, target: stage.target, other: stage.other, deliveryMode, click },
			{ before, after },
		);
	} finally {
		await engine.close();
	}
}

/** Heartbeats (the host's poll for listener transitions) until the engine announces the latch. */
async function latched(engine: Engine): Promise<JsonObject> {
	let found: JsonObject | undefined;
	await until(async () => {
		await engine.call("stopPath.heartbeat");
		const note = engine.notifications.find((n) => n.method === "stopPath.changed" && asObject(n.params).suspended === true);
		found = note === undefined ? undefined : asObject(note.params);
		return found !== undefined;
	}, "stopPath.changed with suspended=true");
	return found ?? {};
}

async function chordLatches(ctx: Context, stage: X11Stage, observe: X11Observer): Promise<Result> {
	const { engine, stop } = await engineFor(ctx, stage);
	try {
		await observe.activate(stage.other);
		const frame = await captureTarget(engine, stage);
		const before = { ...observe.pastes(), globalLive: stop.globalLive ?? null };
		const posted = await ctx.procs.run(["xdotool", "key", "ctrl+alt+shift+Escape"], stage.env);
		const changed = await latched(engine);
		const refused = outcome(await engine.exec("click", clickParams(stage, frame, "background")));
		// Control: an independent XTEST middle click proves the target still records pastes, so an
		// exact +1 shows the refused engine click delivered nothing.
		const control = await ctx.procs.run(
			["xdotool", "mousemove", "--window", stage.target, "20", "20", "click", "2"],
			stage.env,
		);
		const pasted = await observe.pastesAbove(before.count);
		const after = { ...pasted, suspended: changed.suspended ?? null, stoppedBy: changed.stoppedBy ?? null };
		return result(
			"x11-chord-latches",
			{
				global_listener_live: stop.globalLive === true,
				xdotool_posted_chord: posted.code === 0,
				engine_latched: changed.suspended === true,
				click_refused_suspended: refused === "Suspended",
				control_click_delivered: control.code === 0,
				engine_delivered_nothing: pasted.count === before.count + 1,
			},
			{ display: stage.display, chord: "ctrl+alt+shift+Escape", refused, stopPathChanged: changed },
			{ before, after },
		);
	} finally {
		await engine.close();
	}
}

export const X11_SCENARIOS = [
	"x11-capture-click-xterm",
	"x11-focus-guard",
	"x11-background-keeps-active-window",
	"x11-chord-latches",
] as const;
export type X11Scenario = (typeof X11_SCENARIOS)[number];

export function runX11(name: X11Scenario, ctx: Context, stage: X11Stage, observe: X11Observer): Promise<Result> {
	switch (name) {
		case "x11-capture-click-xterm":
			return captureClick(ctx, stage, observe);
		case "x11-focus-guard":
			return deliveredClick(ctx, stage, observe, "foreground");
		case "x11-background-keeps-active-window":
			return deliveredClick(ctx, stage, observe, "background");
		case "x11-chord-latches":
			return chordLatches(ctx, stage, observe);
	}
}

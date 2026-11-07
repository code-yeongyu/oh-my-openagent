import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type Computer, ComputerError, connect, type Window } from "../src/index";
import { type FakePort, fakeEnginePort, nextEvent } from "./fake-port";

const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../facade-manifest.json");
const manifest: { readonly methods: readonly { readonly method: string }[] } = JSON.parse(
	readFileSync(manifestPath, "utf8"),
);

interface Context {
	readonly computer: Computer;
	readonly port: FakePort;
	readonly code: Window;
}

const ports: FakePort[] = [];

async function open(env: Readonly<Record<string, string>> = {}): Promise<Context> {
	const port = fakeEnginePort(env);
	ports.push(port);
	const computer = await connect({ kind: "inProcess", port }, { confirmControl: async () => true });
	return { computer, port, code: await computer.window({ app: "Code" }) };
}

afterEach(async () => {
	await Promise.all(ports.splice(0).map((port) => port.close()));
});

const LEGACY = { delivery: "delivered_unverified", retry: "unsafe" };

/** One call of every manifest method against the fake engine, each asserting its typed result. */
const EVERY_METHOD: Readonly<Record<string, (context: Context) => Promise<void>>> = {
	"Computer.capabilities": async ({ computer }) => {
		expect((await computer.capabilities()).backend).toBe("fake");
	},
	"Computer.displays": async ({ computer }) => {
		const [display] = await computer.displays();
		expect(display?.pixelBounds).toEqual({ x: 0, y: 0, width: 2880, height: 1800 });
	},
	"Computer.windows": async ({ computer }) => {
		expect((await computer.windows()).map((window) => window.id)).toEqual(["101", "202"]);
		expect((await computer.windows({ title: "inbox" })).map((window) => window.app)).toEqual(["Mail"]);
	},
	"Computer.window": async ({ computer }) => {
		const mail = await computer.window("202");
		expect([mail.kind, mail.app, mail.bounds]).toEqual(["window", "Mail", { x: 100, y: 100, width: 900, height: 700 }]);
	},
	"Computer.verify": async ({ computer }) => {
		expect((await computer.verify({ kind: "windowExists", window: { app: "Mail" } })).status).toBe("satisfied");
	},
	"Computer.batch": async ({ computer, code }) => {
		const frame = await code.screenshot();
		const report = await computer.batch([
			{ label: "click", run: () => code.pointer.click({ frame, x: 1, y: 2 }) },
			{ label: "type", run: () => code.keyboard.type("hi") },
		]);
		expect(report).toMatchObject({ completed: 2, of: 2, stoppedAt: null });
	},
	"Computer.close": async ({ computer }) => {
		await computer.close();
		const refused = await computer.capabilities().catch((error: unknown) => error);
		expect(refused).toMatchObject({ code: "Closed", nothingSent: true });
	},
	"Target.screenshot": async ({ computer }) => {
		const frame = await computer.desktop.screenshot({ maxDimension: 1280 });
		expect([frame.target, frame.mimeType, frame.image?.length, frame.coordinateWidth]).toEqual([
			"desktop",
			"image/png",
			70,
			1280,
		]);
	},
	"Target.observe": async ({ code }) => {
		const { frame, ax } = await code.observe();
		expect([frame.target, ax.text, ax.nodeCount]).toEqual(["101", "button Run [ref=e1]", 1]);
	},
	"Target.ax": async ({ code }) => {
		expect(await code.ax({ maxDepth: 2 })).toMatchObject({ text: "button Run [ref=e1]", truncated: false, cuts: [] });
	},
	"Frame.zoom": async ({ code }) => {
		const zoom = await (await code.screenshot()).zoom({ x: 0, y: 0, width: 10, height: 10 });
		expect([zoom.region, zoom.width]).toEqual([{ x: 0, y: 0, width: 10, height: 10 }, 20]);
	},
	"Pointer.click": async ({ code }) => {
		const frame = await code.screenshot();
		expect((await code.pointer.click({ frame, x: 5, y: 5 }, { button: "left", count: 2 })).disposition).toEqual(LEGACY);
	},
	"Pointer.move": async ({ code }) => {
		const frame = await code.screenshot();
		expect((await code.pointer.move({ frame, x: 5, y: 5 })).legacy).toBe(true);
	},
	"Pointer.drag": async ({ code, port }) => {
		const frame = await code.screenshot();
		await code.pointer.drag({ frame, x: 1, y: 1 }, { frame, x: 9, y: 9 });
		expect(port.requests.at(-1)).toMatchObject({ method: "drag", params: { path: [{ x: 1, y: 1 }, { x: 9, y: 9 }] } });
	},
	"Pointer.scroll": async ({ code, port }) => {
		const frame = await code.screenshot();
		await code.pointer.scroll({ frame, x: 3, y: 4 }, { dx: 0, dy: -2 });
		expect(port.requests.at(-1)).toMatchObject({ method: "scroll", params: { dx: 0, dy: -2, frameId: frame.id } });
	},
	"Pointer.hold": async ({ code, port }) => {
		const frame = await code.screenshot();
		await code.pointer.hold({ frame, x: 3, y: 4 }, { durationSeconds: 0.1, button: "right" });
		expect(port.requests.at(-1)).toMatchObject({ method: "holdMouse", params: { duration: 0.1, button: "right" } });
	},
	"Keyboard.type": async ({ code, port }) => {
		await code.keyboard.type("hello", { delivery: "foreground" });
		expect(port.requests.at(-1)).toMatchObject({ method: "typeText", params: { opts: { deliveryMode: "foreground" } } });
	},
	"Keyboard.chord": async ({ code, port }) => {
		await code.keyboard.chord("cmd + s", { force: true });
		expect(port.requests.at(-1)).toMatchObject({ method: "keyChord", params: { keys: ["cmd", "s"], force: true } });
	},
	"Keyboard.hold": async ({ code, port }) => {
		await code.keyboard.hold(["shift"], { durationSeconds: 0 });
		expect(port.requests.at(-1)).toMatchObject({ method: "holdKeys", params: { keys: ["shift"], duration: 0 } });
	},
	"Window.raise": async ({ code, port }) => {
		await code.raise();
		expect(port.requests.at(-1)).toMatchObject({ method: "raiseWindow", params: { windowId: "101" } });
	},
	"Window.element": async ({ code, port }) => {
		const before = port.requests.length;
		const element = code.element("e1");
		expect([element.ref, element.node, port.requests.length]).toEqual(["e1", null, before]);
	},
	"Window.find": async ({ code }) => {
		const [button] = await code.find({ role: "button" });
		expect([button?.ref, button?.node?.bounds]).toEqual(["e1", { x: 10, y: 20, width: 30, height: 40 }]);
	},
	"Menus.items": async ({ code }) => {
		expect((await code.menu.items(["File"])).map((item) => item.shortcut)).toEqual(["Cmd+S", null]);
	},
	"Menus.select": async ({ code, port }) => {
		await code.menu.select(["File", "Save"]);
		expect(port.requests.at(-1)).toMatchObject({ method: "menus.select", params: { path: ["File", "Save"] } });
	},
	"Element.read": async ({ code }) => {
		expect(await code.element("e1").read()).toMatchObject({ role: "button", enabled: true, secure: false });
	},
	"Element.press": async ({ code, port }) => {
		await code.element("e1").press();
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.perform", params: { ref: "e1", action: "press" } });
	},
	"Element.click": async ({ code, port }) => {
		await code.element("e1").click({ delivery: "background" });
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.click", params: { opts: { deliveryMode: "background" } } });
	},
	"Element.setValue": async ({ code, port }) => {
		await code.element("e1").setValue("x");
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.setValue", params: { value: "x" } });
	},
	"Element.type": async ({ code }) => {
		expect(await code.element("e1").type("x")).toMatchObject({ input: "inserted", legacy: true });
	},
	"Element.focus": async ({ code, port }) => {
		await code.element("e1").focus();
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.focus", params: { ref: "e1" } });
	},
	"Element.perform": async ({ code, port }) => {
		await code.element("e1").perform("showMenu");
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.perform", params: { action: "showMenu" } });
	},
	"Element.attributes": async ({ code }) => {
		expect(await code.element("e1").attributes()).toEqual({ AXRole: "AXButton" });
	},
	"Element.drill": async ({ code, port }) => {
		await code.element("e1").drill({ maxDepth: 1 });
		expect(port.requests.at(-1)).toMatchObject({ method: "ax.snapshot", params: { target: "101", opts: { root: "e1" } } });
	},
	"ControlLease.release": async ({ computer }) => {
		const lease = await computer.control.acquire("move a dialog");
		await lease.release();
		expect((await computer.control.state()).active).toBe(false);
	},
	"Control.acquire": async ({ computer }) => {
		expect(await computer.control.acquire("  move a dialog ")).toMatchObject({ active: true, reason: "move a dialog" });
	},
	"Control.state": async ({ computer }) => {
		expect(await computer.control.state()).toEqual({ active: false, reason: null, grantedAt: null });
	},
	"Control.release": async ({ computer }) => {
		await computer.control.acquire("raise");
		await computer.control.release();
		expect((await computer.control.state()).active).toBe(false);
	},
	"StopPath.status": async ({ computer }) => {
		expect(await computer.stop.status()).toMatchObject({ suspended: false, stopPath: "global" });
	},
	"StopPath.on": async ({ computer, port }) => {
		const changed = nextEvent(computer.stop.on, "stopPath.changed");
		await port.call("stopPath.stop", {});
		expect((await changed).suspended).toBe(true);
	},
	"Events.on": async ({ computer, code, port }) => {
		const audit = nextEvent(computer.audit.on, "an audit event");
		const epoch = nextEvent(computer.epoch.on, "an epoch.changed event");
		const frame = await code.screenshot();
		await code.pointer.click({ frame, x: 1, y: 1 });
		port.inject({ jsonrpc: "2.0", method: "epoch.changed", params: { reason: "display" } });
		expect([(await audit).action, (await epoch).reason]).toEqual(["click", "display"]);
	},
};

describe("facade over the fake engine", () => {
	it("#given the committed manifest #when listing the table #then every manifest method has exactly one case", () => {
		expect(Object.keys(EVERY_METHOD).sort()).toEqual(manifest.methods.map((entry) => entry.method).sort());
	});

	for (const [method, run] of Object.entries(EVERY_METHOD)) {
		it(`#given a connected computer #when calling ${method} #then it returns the typed result`, async () => {
			await run(await open());
		});
	}

	it("#given an inProcess fake port #when observing a window found by app #then a typed Frame and AxSnapshot come back", async () => {
		const port = fakeEnginePort();
		ports.push(port);
		const computer = await connect({ kind: "inProcess", port });
		const win = await computer.window({ app: "Code" });
		const observation = await win.observe();

		expect(observation.frame).toMatchObject({ target: "101", width: 1200, height: 800, region: null });
		expect(observation.frame.image).toBeInstanceOf(Uint8Array);
		expect(observation.ax).toEqual({
			text: "button Run [ref=e1]",
			nodeCount: 1,
			truncated: false,
			generation: null,
			parent: null,
			complete: null,
			nodesObserved: null,
			cuts: [],
		});
	});

	it("#given two windows #when window() matches both or none #then ambiguous and not-found refuse before any input", async () => {
		const { computer } = await open();
		const ambiguous = await computer.window({}).catch((error: unknown) => error);
		const missing = await computer.window({ app: "Nope" }).catch((error: unknown) => error);

		expect(ambiguous).toBeInstanceOf(ComputerError);
		expect(ambiguous).toMatchObject({ code: "InvalidTarget", nothingSent: true, data: { reason: "ambiguous" } });
		expect((ambiguous as ComputerError).data.candidates?.map((window) => window.id)).toEqual(["101", "202"]);
		expect(missing).toMatchObject({ code: "WindowNotFound", nothingSent: true });
	});

	it("#given no confirm channel #when acquiring control #then ControlRequired after_user and no grant is sent", async () => {
		const port = fakeEnginePort();
		ports.push(port);
		const computer = await connect({ kind: "inProcess", port });
		const refused = await computer.control.acquire("raise").catch((error: unknown) => error);

		expect(refused).toMatchObject({
			code: "ControlRequired",
			nothingSent: true,
			disposition: { delivery: "not_delivered", retry: "after_user" },
			data: { reason: "no_confirm_channel" },
		});
		expect(port.requests.map((request) => request.method)).not.toContain("control.grant");
	});
});

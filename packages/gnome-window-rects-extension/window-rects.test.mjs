import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { describeChrome, describeReply, describeShell, describeWindows, INTERFACE_XML, OBJECT_PATH } from "./window-rects.js";

const BACKEND = new URL("../../crates/senpi-desktop-backend-wayland/", import.meta.url);
const FIXTURE = JSON.parse(readFileSync(new URL("testdata/gnome-windows.json", BACKEND), "utf8"));
const GNOME_RS = readFileSync(new URL("src/compositor/gnome.rs", BACKEND), "utf8");

const ACTIVE = { name: "workspace 1" };
const OTHER = { name: "workspace 2" };

/** A Clutter actor as Main.layoutManager tracks it: stage position and size, mapped or not. */
function trackedActor({ x, y, width, height, mapped = true, affectsInputRegion = true }) {
	return {
		affectsInputRegion,
		actor: {
			is_mapped: () => mapped,
			get_transformed_position: () => [x, y],
			get_transformed_size: () => [width, height],
		},
	};
}

const IDLE = { overviewVisible: false, modalCount: 0, locked: false };

function metaWindow({ sequence, pid, title, rect, minimized = false, hidden = false, workspace = ACTIVE, desktop = false }) {
	return {
		desktop,
		minimized,
		get_stable_sequence: () => sequence,
		get_pid: () => pid,
		get_title: () => title,
		get_frame_rect: () => rect,
		is_hidden: () => hidden,
		located_on_workspace: (candidate) => candidate === workspace,
	};
}

describe("describeWindows", () => {
	test("cross-language reply contract: Mutter windows render as the fixture the Rust backend parses", () => {
		// Given: the GNOME 47 stack the backend's fixture describes, bottom first
		const windows = [
			metaWindow({ sequence: 3, pid: 801, title: "Desktop Icons", rect: { x: 0, y: 0, width: 2560, height: 1440 }, desktop: true }),
			metaWindow({ sequence: 17, pid: 1201, title: "~ : bash", rect: { x: 10, y: 48, width: 1260, height: 1012 } }),
			metaWindow({ sequence: 21, pid: 1302, title: "notes.txt - Text Editor", rect: { x: 1290, y: 48, width: 1260, height: 1012 } }),
			metaWindow({ sequence: 22, pid: 1302, title: "Save As", rect: { x: 1500, y: 300, width: 600, height: 400 } }),
			metaWindow({ sequence: 25, pid: 1403, title: "Docs - Firefox", rect: { x: 200, y: 100, width: 1000, height: 800 }, minimized: true }),
			metaWindow({ sequence: 30, pid: 1504, title: "Settings", rect: { x: 300, y: 200, width: 900, height: 700 }, workspace: OTHER }),
			metaWindow({ sequence: 31, pid: 1605, title: "Picture-in-Picture", rect: { x: 2200, y: 1100, width: 320, height: 180 } }),
		];

		// and the shell idle, its top bar taking input, the message tray's full-width box
		// not taking input, and the banner bin unmapped (no notification showing)
		const tracked = [
			trackedActor({ x: 0, y: 0, width: 2560, height: 32 }),
			trackedActor({ x: 0, y: 0, width: 2560, height: 1440, affectsInputRegion: false }),
			trackedActor({ x: 980, y: 40, width: 600, height: 120, mapped: false }),
		];

		// When
		const described = describeReply({ windows, workspace: ACTIVE, isDesktopWindow: (window) => window.desktop, shell: IDLE, tracked });

		// Then
		expect(described).toEqual(FIXTURE);
	});

	test("a hidden window, a null title and an unknown pid stay in the reply as not shown, empty and 0", () => {
		const [described] = describeWindows(
			[metaWindow({ sequence: 9, pid: -1, title: null, rect: { x: 1.4, y: 2.6, width: 10, height: 20 }, hidden: true })],
			ACTIVE,
			() => false,
		);

		expect(described).toEqual({
			id: "9",
			pid: 0,
			title: "",
			x: 1,
			y: 3,
			width: 10,
			height: 20,
			shown: false,
			desktopWindow: false,
		});
	});

	test("the overview, a shell modal and the lock screen are each reported as shell state", () => {
		expect(describeShell(IDLE)).toEqual({ overview: false, modal: false, locked: false });
		expect(describeShell({ ...IDLE, overviewVisible: true })).toEqual({ overview: true, modal: false, locked: false });
		expect(describeShell({ ...IDLE, modalCount: 2 })).toEqual({ overview: false, modal: true, locked: false });
		expect(describeShell({ overviewVisible: false, modalCount: 1, locked: true })).toEqual({ overview: false, modal: true, locked: true });
	});

	test("a showing notification banner is reported as chrome; unmapped, input-transparent and empty actors are not", () => {
		const chrome = describeChrome([
			trackedActor({ x: 980.4, y: 39.6, width: 600, height: 120.2 }),
			trackedActor({ x: 0, y: 0, width: 2560, height: 32, mapped: false }),
			trackedActor({ x: 0, y: 0, width: 2560, height: 1440, affectsInputRegion: false }),
			trackedActor({ x: 5, y: 5, width: 0, height: 10 }),
		]);

		expect(chrome).toEqual([{ x: 980, y: 40, width: 600, height: 120 }]);
	});

	test("cross-language D-Bus contract: the exported path and interface are the ones the Rust backend calls", () => {
		expect(GNOME_RS).toContain(`pub const RECTS_PATH: &str = "${OBJECT_PATH}";`);
		const iface = /interface name="([^"]+)"/.exec(INTERFACE_XML)?.[1];
		expect(GNOME_RS).toContain(`pub const RECTS_IFACE: &str = "${iface}";`);
		expect(INTERFACE_XML).toContain('<method name="List">');
	});
});

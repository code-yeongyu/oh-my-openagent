import { afterEach, describe, expect, it } from "vitest";
import { ComputerDisabledError } from "../src/activation";
import { COMPUTER_COMMAND_USAGE, runComputerCommand } from "../src/command";
import { closeDesktops, desktopFixture, hostContext, methodsOf } from "./fixtures";

// Every case waits on real child-process I/O; the guard only catches a hang, it never times behavior.
const HANG_GUARD = { timeout: 30_000 };

afterEach(closeDesktops);

describe("/computer command", HANG_GUARD, () => {
	it("prints the live stopPath, focusGuard, and permissions in status once active", async () => {
		// Given
		const { handle } = desktopFixture();
		await runComputerCommand("on", handle, hostContext());

		// When
		const text = await runComputerCommand("status", handle, hostContext());

		// Then
		expect(text).toMatch(/stopPath=global .*focusGuard=true .*capturePermission=granted/);
	});

	it("reports status without starting an engine", async () => {
		// Given
		const { handle, log } = desktopFixture();

		// When
		const text = await runComputerCommand("status", handle, hostContext());

		// Then
		expect({ keys: /stopPath=.*focusGuard=/.test(text), spawned: log.children.length }).toEqual({
			keys: true,
			spawned: 0,
		});
	});

	it("sends stopPath.resume exactly once for /computer resume", async () => {
		// Given
		const { handle, log } = desktopFixture();
		await runComputerCommand("on", handle, hostContext());
		await runComputerCommand("stop", handle, hostContext());

		// When
		const text = await runComputerCommand("resume", handle, hostContext());

		// Then
		expect({
			lifted: text.includes("suspended=false"),
			resumes: methodsOf(log).filter((method) => method === "stopPath.resume").length,
		}).toEqual({ lifted: true, resumes: 1 });
	});

	it("reports a latched stop path as suspended in status", async () => {
		// Given: the user stopped input.
		const { handle } = desktopFixture();
		await runComputerCommand("on", handle, hostContext());
		await runComputerCommand("stop", handle, hostContext());

		// When
		const text = await runComputerCommand("status", handle, hostContext());

		// Then
		expect(text).toMatch(/^stop: stopPath=\S+ suspended=true/m);
	});

	it("latches the stop path through the handle without any TUI", async () => {
		// Given: an active session and no UI surface at all.
		const { handle } = desktopFixture();
		await handle.activate(hostContext());

		// When
		const status = await handle.stop();

		// Then
		expect(status?.suspended).toBe(true);
	});

	it("arms the stop chord when /computer on activates the tool", async () => {
		// Given
		const { handle, log } = desktopFixture({ stopHotkey: "ctrl+alt+shift+f12" });
		const changes: boolean[] = [];
		handle.onActivationChange((active) => changes.push(active));

		// When
		await runComputerCommand("on", handle, hostContext());

		// Then
		const starts = log.requests.filter((request) => request.method === "stopPath.start");
		expect({ changes, starts: starts.map((request) => request.params) }).toEqual({
			changes: [true],
			starts: [{ chord: "ctrl+alt+shift+f12" }],
		});
	});

	it("turns computer use off for the session so the next activation fails closed", async () => {
		// Given
		const { handle } = desktopFixture();
		await runComputerCommand("on", handle, hostContext());
		await runComputerCommand("off", handle, hostContext());

		// When
		const activation = handle.activate(hostContext());

		// Then
		await expect(activation).rejects.toBeInstanceOf(ComputerDisabledError);
	});

	it("answers an unknown subcommand with the usage line", async () => {
		// Given
		const { handle } = desktopFixture();

		// When
		const text = await runComputerCommand("reset", handle, hostContext());

		// Then
		expect(text).toBe(COMPUTER_COMMAND_USAGE);
	});
});

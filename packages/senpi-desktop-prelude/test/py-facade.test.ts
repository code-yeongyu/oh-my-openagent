import { describe, expect, it } from "vitest";
import { IMAGE, runPythonFacade, WINDOW_SNAPSHOT } from "./harness";

describe("Python computer facade", () => {
	it("turns keyword arguments into one trailing options object", () => {
		// When
		const run = runPythonFacade(
			"win = computer.window(app='Code')\nwin.click(10, 20, button='right', delivery=None)",
		);

		// Then
		expect(run.calls).toEqual([
			{ action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
			{
				action: "call",
				chain: [
					{ method: "window", args: ["w1"] },
					{ method: "click", args: [10, 20, { button: "right" }] },
				],
			},
		]);
	});

	it("drops trailing None positionals and sends no empty options object", () => {
		// When
		const run = runPythonFacade("computer.scroll(3, 4, None)");

		// Then
		expect(run.calls).toEqual([{ action: "call", chain: [{ method: "scroll", args: [3, 4] }] }]);
	});

	it("sends raise_() as the raise method", () => {
		// When
		const run = runPythonFacade("computer.window(app='Code').raise_()");

		// Then
		expect(run.calls[1]).toEqual({
			action: "call",
			chain: [
				{ method: "window", args: ["w1"] },
				{ method: "raise", args: [] },
			],
		});
	});

	it("returns details.value and displays every result image", () => {
		// When
		const run = runPythonFacade("out = computer.screenshot(silent=False)");

		// Then
		expect({ out: run.out, displayed: run.displayed }).toEqual({ out: { width: 1 }, displayed: [IMAGE] });
	});

	it("raises RuntimeError with the result text when the tool reports an error", () => {
		// When
		const run = runPythonFacade("computer.clipboard.write('secret')");

		// Then
		expect(run.error).toBe("RuntimeError: PermissionDenied: computer:exec is denied");
	});

	it("raises RuntimeError with the COMPUTER_PERMISSION_REQUIRED text when a permission denial comes back as an error", () => {
		// Given — the shape a code-mode marshal produces for the denial at omo #9475
		const text =
			"COMPUTER_PERMISSION_REQUIRED: screen recording is not granted. Do not retry until the user says the grant is done and the app was relaunched.";
		const denial = JSON.stringify({
			text,
			details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" }, isError: true },
			hasError: true,
			images: [],
		});

		// When
		const run = runPythonFacade("computer.screenshot()", { screenshot: denial });

		// Then
		expect(run.error).toBe(`RuntimeError: ${text}`);
	});

	it("exposes the resolved window's identity fields on the handle", () => {
		// When
		const run = runPythonFacade(
			"w = computer.window(app='Code')\nout = {f: getattr(w, f) for f in ('id', 'app', 'title', 'pid', 'bounds', 'focused')}",
		);

		// Then
		expect(run.out).toEqual(WINDOW_SNAPSHOT);
	});

	it("sends computer.run options only when set", () => {
		// When
		const run = runPythonFacade("computer.run('return 1;', read_only=True)");

		// Then
		expect(run.calls).toEqual([{ action: "run", code: "return 1;", read_only: true }]);
	});

	it("refuses a Python callable for computer.run before calling the tool", () => {
		// When
		const run = runPythonFacade("computer.run(lambda: 1)");

		// Then
		expect({ error: run.error, calls: run.calls }).toEqual({
			error: "TypeError: computer.run() expects a JavaScript code string",
			calls: [],
		});
	});

	it("sends menu.items and menu.select as window-hopped chains with the path forwarded", () => {
		// When
		const run = runPythonFacade(
			"win = computer.window(app='Code')\nwin.menu.items()\nwin.menu.items(['File'])\nwin.menu.select(['File', 'Export…', 'PDF'])",
		);

		// Then
		expect(run.calls).toEqual([
			{ action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
			{
				action: "call",
				chain: [
					{ method: "window", args: ["w1"] },
					{ method: "menu.items", args: [] },
				],
			},
			{
				action: "call",
				chain: [
					{ method: "window", args: ["w1"] },
					{ method: "menu.items", args: [["File"]] },
				],
			},
			{
				action: "call",
				chain: [
					{ method: "window", args: ["w1"] },
					{ method: "menu.select", args: [["File", "Export…", "PDF"]] },
				],
			},
		]);
	});
});

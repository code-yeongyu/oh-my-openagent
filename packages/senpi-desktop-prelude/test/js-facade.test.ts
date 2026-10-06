import { describe, expect, it } from "vitest";
import { IMAGE, loadJsFacade, WINDOW_SNAPSHOT, windowResponder } from "./harness";

type AsyncBody = new (...parameters: string[]) => (...args: unknown[]) => Promise<unknown>;
const AsyncFunction: AsyncBody = Object.getPrototypeOf(async () => {}).constructor;

describe("JavaScript computer facade", () => {
	it("sends a window click as one two-step call chain through tool.computer", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		await kernel.run(
			`const win = await computer.window({ app: "Code" }); await win.click(1, 2, { delivery: "foreground" });`,
		);

		// Then
		expect(kernel.calls).toEqual([
			{ action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] },
			{
				action: "call",
				chain: [
					{ method: "window", args: ["w1"] },
					{ method: "click", args: [1, 2, { delivery: "foreground" }] },
				],
			},
		]);
	});

	it("exposes the resolved window's identity fields on the handle", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		const serialized = await kernel.run(`return JSON.stringify(await computer.window({ app: "Code" }));`);

		// Then
		expect(JSON.parse(String(serialized))).toEqual(WINDOW_SNAPSHOT);
	});

	it("returns details.value and displays every result image", async () => {
		// Given
		const kernel = loadJsFacade(() => ({
			text: "screenshot desktop 1x1",
			details: { value: { width: 1 } },
			images: [IMAGE],
		}));

		// When
		const value = await kernel.run("return await computer.screenshot();");

		// Then
		expect({ value, displayed: kernel.displayed }).toEqual({ value: { width: 1 }, displayed: [IMAGE] });
	});

	it("throws the result text when the tool reports an error", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "Suspended: the user pressed the stop chord", hasError: true }));

		// When
		const call = kernel.run("await computer.click(5, 5);");

		// Then
		await expect(call).rejects.toThrow("Suspended: the user pressed the stop chord");
	});

	it("throws the COMPUTER_PERMISSION_REQUIRED text when a permission denial comes back as an error", async () => {
		// Given — the shape a code-mode marshal produces for the denial at omo #9475
		const text =
			'COMPUTER_PERMISSION_REQUIRED: accessibility permission is missing. Do not retry until the user says the grant is done and the app was relaunched.';
		const kernel = loadJsFacade(() => ({ text, details: { value: { code: "COMPUTER_PERMISSION_REQUIRED" }, isError: true }, hasError: true }));

		// When
		const call = kernel.run("await computer.screenshot();");

		// Then
		await expect(call).rejects.toThrow("COMPUTER_PERMISSION_REQUIRED");
	});

	it("drops trailing undefined arguments from a chain step", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		await kernel.run("await computer.scroll(3, 4, undefined);");

		// Then
		expect(kernel.calls).toEqual([{ action: "call", chain: [{ method: "scroll", args: [3, 4] }] }]);
	});

	it("rejects a function argument to a direct helper before calling the tool", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		const call = kernel.run("await computer.windows(() => true);");

		// Then
		await expect(call).rejects.toThrow(TypeError);
		expect(kernel.calls).toEqual([]);
	});

	it("never sends a three-step chain: a window handle has no window() to chain", async () => {
		// Given
		const kernel = loadJsFacade(windowResponder);

		// When
		const call = kernel.run(`const win = await computer.window({ app: "Code" }); await win.window({ app: "Code" });`);

		// Then
		await expect(call).rejects.toThrow(TypeError);
		expect(kernel.calls).toEqual([{ action: "call", chain: [{ method: "window", args: [{ app: "Code" }] }] }]);
	});

	it("serializes computer.run(fn) into code that calls fn with the run scope and the args", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "" }));
		await kernel.run(`
			await computer.run(async ({ desktop }, name, pattern, pick) => pick(await desktop.windows(), name, pattern), {
				args: ["Code", /main\\.ts$/i, (list, name, pattern) => list.filter((w) => w.app === name && pattern.test(w.title))],
				read_only: true,
				timeout: 30,
			});
		`);
		const [request] = kernel.calls;
		const desktop = { windows: async () => [WINDOW_SNAPSHOT, { ...WINDOW_SNAPSHOT, id: "w2", title: "README.md" }] };

		// When
		const value = await new AsyncFunction("desktop", "wait", "assert", String(request.code))(desktop, null, null);

		// Then
		expect({ action: request.action, read_only: request.read_only, timeout: request.timeout, value }).toEqual({
			action: "run",
			read_only: true,
			timeout: 30,
			value: [WINDOW_SNAPSHOT],
		});
	});

	it("sends a code string to computer.run unchanged", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "", details: { value: 7 } }));

		// When
		const value = await kernel.run(`return await computer.run("return 7;");`);

		// Then
		expect({ value, calls: kernel.calls }).toEqual({ value: 7, calls: [{ action: "run", code: "return 7;" }] });
	});

	it("maps capabilities() and close() to their own tool actions", async () => {
		// Given
		const kernel = loadJsFacade(() => ({ text: "" }));

		// When
		await kernel.run("await computer.capabilities(); await computer.close();");

		// Then
		expect(kernel.calls).toEqual([{ action: "capabilities" }, { action: "close" }]);
	});
});

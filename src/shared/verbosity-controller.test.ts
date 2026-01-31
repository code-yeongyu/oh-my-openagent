import { describe, it, expect } from "bun:test";
import { VerbosityController } from "./verbosity-controller";

describe("VerbosityController", () => {
	it("should monitor token usage rate and return normal mode below 70%", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const mode = controller.getVerbosityMode(0.65);

		//#then
		expect(mode).toBe("normal");
	});

	it("should switch to concise mode at 70% usage", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const mode = controller.getVerbosityMode(0.75);

		//#then
		expect(mode).toBe("concise");
	});

	it("should switch to minimal mode at 90% usage", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const mode = controller.getVerbosityMode(0.95);

		//#then
		expect(mode).toBe("minimal");
	});

	it("should inject concise mode instructions", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const instructions = controller.getVerbosityInstructions("concise");

		//#then
		expect(instructions).toContain("CONCISE MODE ACTIVE");
		expect(instructions).toContain("Provide brief explanations");
	});

	it("should inject minimal mode instructions", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const instructions = controller.getVerbosityInstructions("minimal");

		//#then
		expect(instructions).toContain("MINIMAL MODE ACTIVE");
		expect(instructions).toContain("Provide ONLY the requested code changes");
	});

	it("should return empty string for normal mode instructions", () => {
		//#given
		const controller = new VerbosityController();

		//#when
		const instructions = controller.getVerbosityInstructions("normal");

		//#then
		expect(instructions).toBe("");
	});
});

import { describe, expect, it } from "vitest";
import { pythonCommandForPlatform } from "./harness";

describe("Python facade interpreter command", () => {
	it("uses the setup-python command on Windows", () => {
		// When
		const command = pythonCommandForPlatform("win32");

		// Then
		expect(command).toBe("python");
	});

	it("keeps the python3 command on POSIX platforms", () => {
		// When
		const commands = [pythonCommandForPlatform("darwin"), pythonCommandForPlatform("linux")];

		// Then
		expect(commands).toEqual(["python3", "python3"]);
	});
});

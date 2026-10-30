import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopService } from "../src/service/service";

const scenario = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../crates/senpi-desktop-backend-fake/fixtures/two-displays-one-window.json",
);

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("DesktopService over the real engine binary", { timeout: 30_000 }, () => {
	it("spawns the located engine with --stdio, opens the fake-backend session, and closes it", async () => {
		// Given: the engine this host would spawn, selecting the fake backend through the inherited env.
		const location = locateDesktopEngine();
		if (location.path === null) {
			// No vendored prebuild or dev build for this host: the locator must say so, not throw.
			expect(location.diagnostic.code).toBe("native-unavailable");
			return;
		}
		vi.stubEnv("SENPI_DESKTOP_BACKEND", `fake:${scenario}`);
		const service = new DesktopService();

		// When
		const opened = await service.open({});
		const capabilities = await service.capabilities();
		await service.close();

		// Then
		expect(opened.backend).toBe("fake");
		expect(capabilities.displayCount).toBe(2);
	});
});

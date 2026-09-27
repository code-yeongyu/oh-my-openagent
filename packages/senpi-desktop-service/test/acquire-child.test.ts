import type { AcquireDesktopEngineOptions, AcquiredDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine";
import { afterEach, describe, expect, it } from "vitest";
import { acquiringEngineChildFactory, type ChildFactory, DesktopEngineUnavailableError } from "../src/service/child";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory } from "./harness";

const services: DesktopService[] = [];

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
});

function serviceWith(createChild: ChildFactory): DesktopService {
	const service = new DesktopService({ createChild });
	services.push(service);
	return service;
}

describe("acquiringEngineChildFactory", () => {
	it("acquires the release engine once, then opens a session on the acquired binary", async () => {
		// Given an acquisition that resolves a path, and a spawn that records it.
		const log = fakeEngineFactory();
		const requests: AcquireDesktopEngineOptions[] = [];
		const spawned: string[] = [];
		const factory = acquiringEngineChildFactory({
			version: "5.0.2",
			host: "darwin-arm64",
			acquire: async (options) => {
				requests.push(options);
				return { path: "/cache/5.0.2/darwin-arm64/senpi-desktop-engine" };
			},
			spawnEngine: (enginePath) => {
				spawned.push(enginePath);
				return log.spawn();
			},
		});

		// When the service opens, and the factory is asked for a second child.
		const opened = await serviceWith(factory).open({});
		await factory();

		// Then the release was acquired once for that version and host, and both spawns used its path.
		expect(opened.backend).toBe("fake");
		expect(requests).toEqual([{ version: "5.0.2", host: "darwin-arm64" }]);
		expect(spawned).toEqual([
			"/cache/5.0.2/darwin-arm64/senpi-desktop-engine",
			"/cache/5.0.2/darwin-arm64/senpi-desktop-engine",
		]);
	});

	it("rejects the open with native-unavailable and spawns nothing when acquisition finds no engine", async () => {
		// Given an acquisition that reports no engine for the host.
		const unavailable: AcquiredDesktopEngine = {
			path: null,
			diagnostic: {
				code: "native-unavailable",
				host: "linux-arm64",
				attemptedPaths: [],
				message: "No senpi-desktop-engine binary is available for linux-arm64.",
				cause: "No desktop engine release asset exists for linux-arm64.",
			},
		};
		const spawned: string[] = [];
		const factory = acquiringEngineChildFactory({
			version: "5.0.2",
			host: "linux-arm64",
			acquire: async () => unavailable,
			spawnEngine: (enginePath) => {
				spawned.push(enginePath);
				throw new Error("must not spawn");
			},
		});

		// When
		const error: unknown = await serviceWith(factory)
			.open({})
			.then(
				() => undefined,
				(rejection: unknown) => rejection,
			);

		// Then the typed error carries the acquisition diagnostic, and no child was started.
		expect(error).toBeInstanceOf(DesktopEngineUnavailableError);
		expect((error as DesktopEngineUnavailableError).diagnostic).toEqual(unavailable.diagnostic);
		expect(spawned).toEqual([]);
	});
});

import { DesktopService } from "@oh-my-opencode/senpi-desktop-service";
// The desktop-service package's scripted engine: a real NDJSON JSON-RPC child, observed on the wire.
import { fakeEngineFactory, type SpawnLog } from "../../senpi-desktop-service/test/harness";
import { ComputerHandle, type ComputerService } from "../src/activation";
import type { ComputerHostContext, ComputerModel } from "../src/session";
import { type ComputerSettingsInput, resolveComputerSettings } from "../src/settings";

/** A service for cases that must never reach the engine: every method rejects. */
export function closedService(): ComputerService {
	const unreachable = () => Promise.reject(new Error("the engine must not be reached"));
	return {
		open: unreachable,
		ensureStopPath: unreachable,
		call: unreachable,
		onAudit: () => () => undefined,
		capabilities: unreachable,
		stopPathStatus: unreachable,
		stop: unreachable,
		resume: unreachable,
		close: () => Promise.resolve(),
		revokeControl: () => Promise.resolve(),
	};
}

export function hostContext(model?: ComputerModel): ComputerHostContext {
	return {
		cwd: "/work",
		model,
		sessionManager: { getSessionId: () => "session-1", getSessionDir: () => "/sessions/project" },
	};
}

export interface DesktopFixture {
	readonly handle: ComputerHandle;
	readonly service: DesktopService;
	readonly log: SpawnLog;
}

const services: DesktopService[] = [];

/** A handle over a real `DesktopService` whose engine child is the scripted fake desktop. */
export function desktopFixture(
	settings: ComputerSettingsInput = {},
	env: Readonly<Record<string, string>> = {},
): DesktopFixture {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	const resolved = resolveComputerSettings(settings, "linux");
	return { handle: new ComputerHandle({ service, settings: () => resolved }), service, log };
}

export async function closeDesktops(): Promise<void> {
	await Promise.all(services.splice(0).map((service) => service.close()));
}

export function methodsOf(log: SpawnLog): readonly string[] {
	return log.requests.map((request) => request.method);
}

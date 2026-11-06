import type { ComputerSessionSnapshot } from "@oh-my-opencode/senpi-desktop-protocol";
import { type ExecuteTool, runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { fakeEngineFactory, type SpawnLog } from "./harness";

// Long enough for a confirm to be asked (the facade keeps 5 s back and needs 3 s more); runs end far sooner.
const RUN_TIMEOUT_MS = 15_000;

const services: DesktopService[] = [];

export async function closeDesktops(): Promise<void> {
	await Promise.all(services.splice(0).map((service) => service.close()));
}

export async function openDesktop(
	env: Record<string, string> = {},
): Promise<{ service: DesktopService; log: SpawnLog }> {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env });
	const service = new DesktopService({ createChild: log.factory });
	services.push(service);
	await service.open({});
	return { service, log };
}

export function snapshot(readOnly: boolean): ComputerSessionSnapshot {
	return {
		cwd: "/work",
		sessionId: "session-1",
		captureMaxWidth: 1280,
		captureMaxHeight: 800,
		captureMaxBytes: 5_000_000,
		display: "all",
		readOnly,
		stopHotkey: "ctrl+alt+shift+escape",
		allowHostRelayOnlyStop: false,
	};
}

export const noTools: ExecuteTool = (name) => Promise.reject(new Error(`unexpected tool ${name}`));

export type ConfirmControl = (reason: string, signal: AbortSignal, budgetMs: number) => Promise<boolean>;

export interface RunOptions {
	readonly readOnly?: boolean;
	readonly signal?: AbortSignal;
	readonly confirmControl?: ConfirmControl;
	readonly timeoutMs?: number;
}

export function run(service: DesktopService, code: string, options: RunOptions = {}) {
	return runComputerCode(
		{
			code,
			snapshot: snapshot(options.readOnly ?? false),
			timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		{
			service,
			executeTool: noTools,
			...(options.confirmControl === undefined ? {} : { confirmControl: options.confirmControl }),
		},
	);
}

export function methods(log: SpawnLog): readonly string[] {
	return log.requests.map((request) => request.method);
}

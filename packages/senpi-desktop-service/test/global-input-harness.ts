import type { AuditEvent } from "@oh-my-opencode/senpi-desktop-protocol";
import { runComputerCode } from "../src/run/runtime";
import { DesktopService } from "../src/service/service";
import { type ConfirmControl, noTools, snapshot } from "./control-harness";
import { fakeEngineFactory, type SpawnLog } from "./harness";

const services: DesktopService[] = [];

export async function closeServices(): Promise<void> {
	await Promise.all(services.splice(0).map((service) => service.close()));
}

/** The session's permission preset as the host reads it; tests flip `value` to model a live preset switch. */
export interface Preset {
	value: boolean;
}

export interface GatedDesktop {
	readonly service: DesktopService;
	readonly log: SpawnLog;
	/** Every audit the engine sent, refusals included. */
	readonly audits: readonly AuditEvent[];
}

/** A service over the fake engine whose desktop and display input mirrors the engine's grant gate (#10788). */
export async function openGated(fullAccess: Preset, env: Record<string, string> = {}): Promise<GatedDesktop> {
	const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", FAKE_ENGINE_GLOBAL_INPUT_GATE: "1", ...env });
	const service = new DesktopService({ createChild: log.factory, fullAccess: () => fullAccess.value });
	services.push(service);
	const audits: AuditEvent[] = [];
	service.onAudit((event) => audits.push(event));
	await service.open({});
	return { service, log, audits };
}

export function runCode(service: DesktopService, code: string, confirmControl?: ConfirmControl) {
	return runComputerCode(
		{ code, snapshot: snapshot(false), timeoutMs: 15_000 },
		{ service, executeTool: noTools, ...(confirmControl === undefined ? {} : { confirmControl }) },
	);
}

/** Input the engine admitted: an audit without an error code. */
export function admitted(desktop: GatedDesktop, action: string): number {
	return desktop.audits.filter((event) => event.action === action && event.code == null).length;
}

export function requested(log: SpawnLog, method: string): number {
	return log.requests.filter((request) => request.method === method).length;
}

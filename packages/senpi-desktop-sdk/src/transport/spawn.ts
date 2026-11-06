import type { RpcPort } from "@oh-my-opencode/senpi-desktop-protocol";
import { ComputerError, refusal } from "../errors";

/** Engine session settings for a spawned engine; the SDK hands them to `launch` unread. */
export type SpawnSettings = Readonly<Record<string, unknown>>;

/**
 * Starts an engine child and returns its connection. The caller injects it (the eval harness and CI pass the
 * `senpi-desktop-engine` locator and handshake), so the SDK itself launches nothing and imports only `-protocol`.
 */
export type SpawnLaunch = (settings: SpawnSettings | undefined) => Promise<RpcPort>;

export interface SpawnTransport {
	readonly kind: "spawn";
	readonly launch: SpawnLaunch;
	readonly settings?: SpawnSettings;
}

/** Set to `"1"` by the host inside its kernels (the generated prelude): code there is already inside an omo session. */
const IN_SESSION_MARKER = "SENPI_DESKTOP_HOST";

/**
 * Launches the engine through `transport.launch`. Inside an omo session it refuses before `launch` runs: a second
 * engine there could grant itself host-only control and its stop path would leave the host. This is an accident
 * guard, not a security boundary: code that can clear the marker can already do anything the host process can.
 */
export async function launchSpawned(transport: SpawnTransport): Promise<RpcPort> {
	if (globalThis.process?.env?.[IN_SESSION_MARKER] === "1") {
		throw refusal(
			"ControlRequired",
			"spawn is refused inside an omo session: use the session's own computer instead of starting a second engine",
			"spawn_inside_session",
			{ disposition: { delivery: "not_delivered", retry: "after_user" }, hint: "use the host computer global" },
		);
	}
	if (typeof transport.launch !== "function") {
		throw refusal("InvalidTarget", "a spawn transport needs a launch function", "missing_launch");
	}
	try {
		return await transport.launch(transport.settings);
	} catch (error) {
		if (error instanceof ComputerError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new ComputerError("Internal", `desktop engine launch failed: ${message}`, {
			disposition: { delivery: "not_delivered", retry: "safe" },
			reason: "launch_failed",
			cause: error,
		});
	}
}

import type { RpcClient } from "./rpc-client";

/** Public `session.open` params; the service fills the default-on cursor preference. */
export interface DesktopSessionOpenParams {
	readonly display?: string | null;
	readonly macosCanary?: "session" | "off";
	readonly showCursor?: boolean;
	readonly allowHostRelayOnlyStop?: boolean;
	readonly auditPath?: string | null;
	readonly artifactDir?: string | null;
	readonly screenshotGc?: { readonly staleMs?: number; readonly scanIntervalMs?: number };
	readonly captureCaps?: {
		readonly maxWidth?: number | null;
		readonly maxHeight?: number | null;
		readonly coordinateSafe?: boolean;
		readonly maxBytes?: number;
	};
}

/** One live engine child and its process-local safety state. */
export interface Connection {
	readonly rpc: RpcClient;
	resumeToken: string;
	armedChord: string | undefined;
	heartbeat: NodeJS.Timeout | undefined;
}

/** What the host asked for; replayed onto a fresh child after restart. */
export interface DesiredSession {
	readonly params: DesktopSessionOpenParams & { readonly showCursor: boolean };
	chord: string | undefined;
}

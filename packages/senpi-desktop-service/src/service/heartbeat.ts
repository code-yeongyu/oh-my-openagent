import type { NotificationHub } from "./notifications";
import { DesktopEngineRpcError, DesktopServiceError } from "./rpc-client";
import type { Connection } from "./session-state";

/** Report unawaited heartbeat failures through the service's existing error channel. */
export function heartbeat(connection: Connection, hub: NotificationHub): void {
	connection.rpc.request("stopPath.heartbeat", {}).catch((error: unknown) => {
		// `Closed` means the child is gone; its exit already dropped the connection.
		if (error instanceof DesktopServiceError && error.code === "Closed") return;
		if (error instanceof DesktopServiceError || error instanceof DesktopEngineRpcError) {
			hub.emitError(error);
			return;
		}
		throw error;
	});
}

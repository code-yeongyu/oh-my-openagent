import { DesktopEngineRpcError } from "../service/rpc-client";
import { ComputerRunError, type RunScope } from "./context";

/** Older engines keep ordinary input working; bounded holds have no fallback. */
export async function callHold(scope: RunScope, method: "holdKeys" | "holdMouse", params: object): Promise<void> {
	try {
		await scope.call(method, params);
	} catch (error) {
		if (error instanceof DesktopEngineRpcError && error.rpcCode === -32601) {
			throw new ComputerRunError("unavailable", `${method} is unavailable in this desktop engine; update the engine for bounded holds`);
		}
		throw error;
	}
}

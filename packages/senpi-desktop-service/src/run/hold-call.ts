import { DesktopEngineRpcError } from "../service/rpc-client";
import { ComputerRunError, type RunScope } from "./context";
import { expectResult, isExecResult } from "./engine-results";

/** Older engines keep ordinary input working; bounded holds have no fallback. */
export async function callHold(scope: RunScope, method: "holdKeys" | "holdMouse", params: object): Promise<void> {
	try {
		expectResult(method, await scope.call(method, params), isExecResult);
	} catch (error) {
		if (error instanceof DesktopEngineRpcError && error.rpcCode === -32601) {
			throw new ComputerRunError("unavailable", `${method} is unavailable in this desktop engine; update the engine for bounded holds`);
		}
		throw error;
	}
}

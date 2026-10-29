import { DesktopServiceError } from "./rpc-client";

export function malformed(method: string): DesktopServiceError {
	return new DesktopServiceError("Internal", `desktop engine sent a malformed ${method} result`);
}

import type { PiCodexAppServerTransportMode } from "./transport-runtime.ts";

export class PiCodexAppServerRuntimeError extends Error {
	readonly mode: PiCodexAppServerTransportMode;

	constructor(mode: PiCodexAppServerTransportMode, message: string) {
		super(message);
		this.name = "PiCodexAppServerRuntimeError";
		this.mode = mode;
	}
}

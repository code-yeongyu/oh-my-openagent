export interface UlwLoopErrorOptions {
	readonly cause?: unknown;
	readonly details?: Record<string, unknown>;
}

export class UlwLoopError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(message: string, code: string, opts?: UlwLoopErrorOptions) {
		super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
		this.name = "UlwLoopError";
		this.code = code;
		if (opts?.details !== undefined) {
			this.details = opts.details;
		}
	}
}

export function iso(): string {
	return new Date().toISOString();
}

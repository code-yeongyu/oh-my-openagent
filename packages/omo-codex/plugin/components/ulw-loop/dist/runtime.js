export class UlwLoopError extends Error {
    constructor(message, code, opts) {
        super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
        this.name = "UlwLoopError";
        this.code = code;
        if (opts?.details !== undefined) {
            this.details = opts.details;
        }
    }
}
export function iso() {
    return new Date().toISOString();
}

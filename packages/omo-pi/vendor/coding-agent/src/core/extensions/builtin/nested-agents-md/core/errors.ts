export class InjectionFileReadError extends Error {
	readonly path: string;

	constructor(path: string, cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause);
		super(`Failed to read ${path}: ${message}`);
		this.name = "InjectionFileReadError";
		this.path = path;
	}
}

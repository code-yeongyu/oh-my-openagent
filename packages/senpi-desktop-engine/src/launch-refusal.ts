/** Startup diagnostics from the actual engine child, never an admission credential. */
export type DesktopLaunchRefusalReason = "self-responsible" | "unresolved";

const MARKER = "SENPI_DESKTOP_LAUNCH_REFUSED";
const MAX_RECORD_BYTES = 512;
const LEGACY_SELF = /^senpi-desktop-engine: refusing to run as its own responsible process \(pid [1-9]\d*\): spawn the engine as a child of the app, terminal or host that holds the computer-use grants, without the responsibility-disclaim attribute and not as a launchd job or through a shell exec$/;
const LEGACY_UNRESOLVED = /^senpi-desktop-engine: refusing to run: the responsible process of engine pid [1-9]\d* cannot be resolved$/;

/** senpi's user-facing error contract: hosts show `message` and `action`, never the stack (senpi#4990). */
export interface UserFacingErrorInfo {
	readonly code: string;
	readonly message: string;
	readonly action?: string;
}

export class DesktopLaunchContextError extends Error {
	readonly code = "launch-context-unavailable";
	readonly reason: DesktopLaunchRefusalReason;
	readonly diagnostic: string;
	readonly userFacing: UserFacingErrorInfo;

	constructor(
		reason: DesktopLaunchRefusalReason,
		diagnostic: string,
	) {
		const detail = reason === "unresolved" ? " macOS responsibility could not be resolved." : "";
		const userFacing = {
			code: "COMPUTER_LAUNCH_CONTEXT_REQUIRED",
			message: `Computer use cannot start safely from this host's current macOS launch context.${detail}`,
			action:
				"Restart this host from a local terminal and keep that terminal app running, or use the OmO desktop app (Settings > Restart engine)." +
				" Opening a new terminal or reconnecting to this same host does not repair its launch context.",
		} as const;
		super(`${userFacing.code}: ${userFacing.message} ${userFacing.action}`);
		this.name = "DesktopLaunchContextError";
		this.reason = reason;
		this.diagnostic = diagnostic;
		this.userFacing = userFacing;
	}
}

function parseRecord(line: string): DesktopLaunchRefusalReason | undefined {
	if (!line.startsWith(`${MARKER} `) || Buffer.byteLength(line, "utf8") + 1 > MAX_RECORD_BYTES) return undefined;
	const json = line.slice(MARKER.length + 1);
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	// JSON.parse accepts duplicate keys; the wire record does not.
	const keys = json.match(/"(?:\\.|[^"\\])*"\s*:/g);
	if (keys?.length !== 2 || Object.keys(value).length !== 2 ||
		!("version" in value) || value.version !== 1 || !("reason" in value)) return undefined;
	return value.reason === "self-responsible" || value.reason === "unresolved" ? value.reason : undefined;
}

/**
 * A bounded line accumulator kept separately from the stderr tail. A caller disables it on
 * hello, protocol failure, cancellation, or a forced kill, and finalizes only at child close.
 */
export class DesktopLaunchRefusal {
	#line = "";
	#oversized = false;
	#disabled = false;
	#structured = false;
	#invalid = false;
	#reason: DesktopLaunchRefusalReason | undefined;
	#legacy: DesktopLaunchRefusalReason | undefined;
	#record = "";

	disable(): void {
		this.#disabled = true;
		this.#line = "";
	}

	push(chunk: string): void {
		if (this.#disabled) return;
		let offset = 0;
		while (offset < chunk.length) {
			const end = chunk.indexOf("\n", offset);
			const part = chunk.slice(offset, end === -1 ? chunk.length : end);
			this.#oversized ||= Buffer.byteLength(this.#line + part, "utf8") >= MAX_RECORD_BYTES;
			this.#line += part.slice(0, Math.max(0, MAX_RECORD_BYTES - this.#line.length));
			if (end === -1) return;
			this.#acceptLine();
			this.#line = "";
			this.#oversized = false;
			offset = end + 1;
		}
	}

	finish(code: number | null, signal: string | null, diagnostic: string): DesktopLaunchContextError | undefined {
		// A partial structured record is not an older engine, even if it printed legacy text earlier.
		if (this.#line.startsWith(MARKER)) this.#invalid = true;
		if (this.#disabled || this.#invalid || code !== 1 || signal !== null) return undefined;
		const reason = this.#structured ? this.#reason : this.#legacy;
		return reason === undefined ? undefined : new DesktopLaunchContextError(reason, `${this.#record}\n${diagnostic}`);
	}

	#acceptLine(): void {
		if (this.#line.startsWith(MARKER)) {
			if (this.#structured) this.#invalid = true;
			this.#structured = true;
			const reason = this.#oversized ? undefined : parseRecord(this.#line);
			if (reason === undefined) this.#invalid = true;
			else {
				this.#reason = reason;
				this.#record = this.#line;
			}
			return;
		}
		if (this.#oversized) return;
		const reason = LEGACY_SELF.test(this.#line) ? "self-responsible"
			: LEGACY_UNRESOLVED.test(this.#line) ? "unresolved" : undefined;
		if (reason !== undefined) {
			if (this.#legacy !== undefined && this.#legacy !== reason) this.#invalid = true;
			this.#legacy = reason;
		}
	}
}

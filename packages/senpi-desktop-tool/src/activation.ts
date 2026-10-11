import type { DesktopCapabilities, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol";
import type { DesktopService } from "@oh-my-opencode/senpi-desktop-service";
import { type ComputerHostContext, sessionOpenParams } from "./session";
import type { ComputerSettings } from "./settings";

/** The `DesktopService` surface the tool, the command, and the activation hook use. */
export type ComputerService = Pick<
	DesktopService,
	| "open"
	| "ensureStopPath"
	| "call"
	| "onAudit"
	| "capabilities"
	| "stopPathStatus"
	| "stop"
	| "resume"
	| "close"
	| "revokeControl"
>;

export interface ComputerHandleOptions {
	readonly service: ComputerService;
	/** Read on every use, so a settings reload applies to the next call. */
	readonly settings: () => ComputerSettings;
}

export type ActivationListener = (active: boolean) => void;

/** `/computer off` switched computer use off for this session. */
export class ComputerDisabledError extends Error {
	constructor() {
		super("Computer use is off for this session; the user can turn it on with /computer on.");
		this.name = "ComputerDisabledError";
	}
}

interface OpenedSession {
	/** JSON of the `session.open` params; re-opening resets captures and AX refs, so only a change re-opens. */
	readonly key: string;
	readonly done: Promise<DesktopCapabilities>;
}

/**
 * The per-agent-session computer state shared by the tool, `/computer`, and the host extension: the
 * session-scoped on/off switch, activation (engine session + armed stop path), and the user-only
 * stop/resume surface. Nothing starts before the first activation.
 */
export class ComputerHandle {
	readonly #service: ComputerService;
	readonly #settings: () => ComputerSettings;
	readonly #listeners = new Set<ActivationListener>();
	#enabledOverride: boolean | undefined;
	#opened: OpenedSession | undefined;
	#active = false;

	constructor(options: ComputerHandleOptions) {
		this.#service = options.service;
		this.#settings = options.settings;
	}

	get service(): ComputerService {
		return this.#service;
	}

	settings(): ComputerSettings {
		return this.#settings();
	}

	/** `computer.enabled`, unless `/computer on|off` overrode it for this session. */
	get enabled(): boolean {
		return this.#enabledOverride ?? this.#settings().enabled;
	}

	get active(): boolean {
		return this.#active;
	}

	/** Whether an engine session is open (started by an activation, not yet closed). */
	get running(): boolean {
		return this.#opened !== undefined;
	}

	/** Session-scoped override of `computer.enabled`; never persisted. */
	setEnabled(enabled: boolean): void {
		this.#enabledOverride = enabled;
	}

	/** Subscribes to activation changes; the host turns them into the active-tool set (todo 26). */
	onActivationChange(listener: ActivationListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Called when the tool becomes active (tool_search promotion, a by-name call, `/computer on`) and before
	 * every tool call: opens the engine session when needed and arms the stop chord. Idempotent.
	 */
	async activate(context: ComputerHostContext): Promise<StopPathStatus> {
		if (!this.enabled) throw new ComputerDisabledError();
		const settings = this.#settings();
		await this.#ensureOpen(settings, context);
		const status = await this.#service.ensureStopPath(settings.stopHotkey);
		this.#setActive(true);
		return status;
	}

	/** Closes the engine session and reports the tool inactive (`/computer off`). */
	async deactivate(): Promise<void> {
		await this.close();
		this.#setActive(false);
	}

	/** Ends the engine session; the next activation starts a fresh one. A stop latch survives it. */
	async close(): Promise<void> {
		this.#opened = undefined;
		await this.#service.close();
	}

	/** Live stop-path state (suspended, reason), or `undefined` when no engine runs (status never starts one). */
	async stopPathStatus(): Promise<StopPathStatus | undefined> {
		return this.running ? this.#service.stopPathStatus() : undefined;
	}

	/** Latches the stop path (user-only, also reachable without a TUI); `undefined` when no engine runs. */
	async stop(): Promise<StopPathStatus | undefined> {
		return this.running ? this.#service.stop() : undefined;
	}

	/** Lifts the stop latch with the service-held token (user-only); `undefined` when no engine runs. */
	async resume(): Promise<StopPathStatus | undefined> {
		return this.running ? this.#service.resume() : undefined;
	}

	/** Live capabilities, or `undefined` when no engine runs (status never starts one). */
	async capabilities(): Promise<DesktopCapabilities | undefined> {
		return this.running ? this.#service.capabilities() : undefined;
	}

	async #ensureOpen(settings: ComputerSettings, context: ComputerHostContext): Promise<void> {
		const params = sessionOpenParams(settings, context);
		const key = JSON.stringify(params);
		if (this.#opened?.key !== key) this.#opened = { key, done: this.#service.open(params) };
		const opened = this.#opened;
		try {
			await opened.done;
		} catch (error) {
			if (this.#opened === opened) this.#opened = undefined;
			throw error;
		}
	}

	#setActive(active: boolean): void {
		if (this.#active === active) return;
		this.#active = active;
		for (const listener of this.#listeners) listener(active);
	}
}

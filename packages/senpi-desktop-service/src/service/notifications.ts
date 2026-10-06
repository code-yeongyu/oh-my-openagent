import {
	type AuditEvent,
	ENGINE_NOTIFICATIONS,
	type EngineNotification,
	type StopPathStatus,
} from "@oh-my-opencode/senpi-desktop-protocol";
import { isAuditEvent, isStopPathStatus } from "./parse";

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

/** A malformed or unknown engine notification. */
export class DesktopNotificationError extends Error {
	readonly method: string;

	constructor(method: string, reason: string) {
		super(`desktop engine notification ${JSON.stringify(method)} ${reason}`);
		this.name = "DesktopNotificationError";
		this.method = method;
	}
}

function subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>): Unsubscribe {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function assertNever(value: never): never {
	throw new Error(`unhandled engine notification ${JSON.stringify(value)}`);
}

/**
 * Fans engine notifications out to host listeners. The host only surfaces them: the engine
 * persists audit records itself, and `engine.log` has no host consumer.
 */
export class NotificationHub {
	readonly #audit = new Set<Listener<AuditEvent>>();
	readonly #stopPath = new Set<Listener<StopPathStatus>>();
	readonly #errors = new Set<Listener<Error>>();

	onAudit(listener: Listener<AuditEvent>): Unsubscribe {
		return subscribe(this.#audit, listener);
	}

	onStopPathChange(listener: Listener<StopPathStatus>): Unsubscribe {
		return subscribe(this.#stopPath, listener);
	}

	/** Failures no caller awaits: heartbeats and malformed notifications. */
	onError(listener: Listener<Error>): Unsubscribe {
		return subscribe(this.#errors, listener);
	}

	emitError(error: Error): void {
		for (const listener of this.#errors) listener(error);
	}

	dispatch(method: string, params: unknown): void {
		const notification = ENGINE_NOTIFICATIONS.find((name) => name === method);
		if (notification === undefined) {
			this.emitError(new DesktopNotificationError(method, "is not part of the engine protocol"));
			return;
		}
		this.#dispatchKnown(notification, params);
	}

	#dispatchKnown(method: EngineNotification, params: unknown): void {
		switch (method) {
			case "audit":
				if (isAuditEvent(params)) {
					for (const listener of this.#audit) listener(params);
				} else {
					this.emitError(new DesktopNotificationError(method, "is malformed"));
				}
				return;
			case "stopPath.changed":
				if (isStopPathStatus(params)) {
					for (const listener of this.#stopPath) listener(params);
				} else {
					this.emitError(new DesktopNotificationError(method, "is malformed"));
				}
				return;
			case "engine.log":
				return;
			default:
				assertNever(method);
		}
	}
}

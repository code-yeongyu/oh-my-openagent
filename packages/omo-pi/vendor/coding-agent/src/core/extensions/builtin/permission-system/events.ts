import type { ExtensionAPI } from "../../types.ts";
import type { PermissionDecision, Request } from "./types.ts";

/**
 * Event type for when a permission is asked.
 * Contains the full request information.
 */
export type PermissionAskedEvent = Request;

/**
 * Event type for when a permission is replied to.
 * Contains the reply and identifiers to correlate with the request.
 */
export type PermissionRepliedEvent = {
	requestID: string;
	sessionID: string;
	reply: PermissionDecision;
};

/**
 * Event emitter interface for permission events.
 * Injectable into services for loose coupling.
 */
export interface PermissionEventEmitter {
	/**
	 * Emit a permission_asked event.
	 * @param request - The permission request being asked
	 */
	emitAsked(request: Request): void;

	/**
	 * Emit a permission_replied event.
	 * @param requestID - The ID of the request being replied to
	 * @param sessionID - The session ID associated with the request
	 * @param reply - The user's reply (once, always, or reject)
	 */
	emitReplied(requestID: string, sessionID: string, reply: PermissionDecision): void;
}

/**
 * Creates an event emitter that wraps pi.events for inter-extension communication.
 * Use this when running within the pi extension system.
 *
 * @param pi - The ExtensionAPI provided by the pi extension system
 * @returns PermissionEventEmitter that emits via pi.events
 */
export function createEventEmitter(pi: ExtensionAPI): PermissionEventEmitter {
	return {
		emitAsked: (request: Request) => {
			pi.events.emit("permission_asked", request);
		},
		emitReplied: (requestID: string, sessionID: string, reply: PermissionDecision) => {
			pi.events.emit("permission_replied", { requestID, sessionID, reply });
		},
	};
}

/**
 * Local event emitter implementation for standalone or test usage.
 * Uses a simple callback registry when pi.events is not available.
 *
 * @returns PermissionEventEmitter with local event handling
 */
export function createLocalEventEmitter(): PermissionEventEmitter & {
	/**
	 * Register a handler for permission_asked events.
	 * @param handler - Callback invoked when a permission is asked
	 * @returns Unsubscribe function
	 */
	onAsked(handler: (request: Request) => void): () => void;

	/**
	 * Register a handler for permission_replied events.
	 * @param handler - Callback invoked when a permission is replied to
	 * @returns Unsubscribe function
	 */
	onReplied(handler: (event: PermissionRepliedEvent) => void): () => void;

	/**
	 * Clear all registered handlers.
	 */
	clear(): void;
} {
	const askedHandlers = new Set<(request: Request) => void>();
	const repliedHandlers = new Set<(event: PermissionRepliedEvent) => void>();

	return {
		emitAsked: (request: Request) => {
			for (const handler of askedHandlers) {
				try {
					handler(request);
				} catch (err) {
					console.error("Error in permission_asked handler:", err);
				}
			}
		},

		emitReplied: (requestID: string, sessionID: string, reply: PermissionDecision) => {
			const event: PermissionRepliedEvent = { requestID, sessionID, reply };
			for (const handler of repliedHandlers) {
				try {
					handler(event);
				} catch (err) {
					console.error("Error in permission_replied handler:", err);
				}
			}
		},

		onAsked: (handler: (request: Request) => void): (() => void) => {
			askedHandlers.add(handler);
			return () => askedHandlers.delete(handler);
		},

		onReplied: (handler: (event: PermissionRepliedEvent) => void): (() => void) => {
			repliedHandlers.add(handler);
			return () => repliedHandlers.delete(handler);
		},

		clear: () => {
			askedHandlers.clear();
			repliedHandlers.clear();
		},
	};
}

import type { EngineNotification, RpcPort } from "@oh-my-opencode/senpi-desktop-protocol";
import { LinkedComputer } from "./computer";
import type { ConfirmControl } from "./control";
import { refusal } from "./errors";
import type { Computer } from "./facade";
import { Link } from "./link";
import { parseAuditEvent, parseEpochChanged, type Parser, parseStopPathStatus } from "./validate";

/**
 * How the SDK reaches an engine session. `inProcess` wraps a port the host already owns (the desktop service, a
 * test fake); `close()` then detaches the SDK and leaves the port to its owner.
 */
export type Transport = { readonly kind: "inProcess"; readonly port: RpcPort };

export interface ConnectOptions {
	/** The host's channel for asking the human before `control.acquire` grants; without it acquiring is refused. */
	readonly confirmControl?: ConfirmControl;
}

const NOTIFICATION_PARSERS: Readonly<Partial<Record<EngineNotification, Parser<unknown>>>> = {
	audit: parseAuditEvent,
	"epoch.changed": parseEpochChanged,
	"stopPath.changed": parseStopPathStatus,
};

/** Opens the SDK over `transport`. Sends nothing on the wire: the first facade call is the first request. */
export async function connect(transport: Transport, options: ConnectOptions = {}): Promise<Computer> {
	if (transport?.kind !== "inProcess") {
		const kind = String((transport as { readonly kind?: unknown } | undefined)?.kind);
		throw refusal("InvalidTarget", `transport kind ${kind} is not available in this SDK`, "unsupported_transport");
	}
	return new LinkedComputer(new Link(transport.port, NOTIFICATION_PARSERS), options.confirmControl);
}

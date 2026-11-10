import type { AuditEvent } from "@oh-my-opencode/senpi-desktop-protocol";
import type { Events } from "./facade";
import type { Link } from "./link";

/** `computer.audit`: one engine `audit` notification per mutating request, success or failure. */
export function auditEvents(link: Link): Events<AuditEvent> {
	return { on: (listener) => link.on("audit", listener) };
}

import { refusal } from "./errors";
import type { Control, ControlLease, ControlState } from "./facade";
import type { Link } from "./link";
import { parseControlState } from "./validate";

/** Asks the human whether the SDK may take foreground control for `reason`; `true` grants. */
export type ConfirmControl = (reason: string) => Promise<boolean>;

const AFTER_USER = { delivery: "not_delivered", retry: "after_user" } as const;

class Lease implements ControlLease {
	readonly active: boolean;
	readonly reason: string | null;
	readonly grantedAt: string | null;
	readonly #control: Control;

	constructor(control: Control, state: ControlState) {
		this.#control = control;
		this.active = state.active;
		this.reason = state.reason;
		this.grantedAt = state.grantedAt;
	}

	release(): Promise<void> {
		return this.#control.release();
	}
}

export class ForegroundControl implements Control {
	readonly #link: Link;
	readonly #confirm: ConfirmControl | undefined;

	constructor(link: Link, confirm: ConfirmControl | undefined) {
		this.#link = link;
		this.#confirm = confirm;
	}

	async acquire(reason: string): Promise<ControlLease> {
		const why = typeof reason === "string" ? reason.trim() : "";
		if (why.length === 0) throw refusal("InvalidTarget", "control.acquire requires a non-empty reason", "empty_reason");
		const current = await this.state();
		if (current.active) return new Lease(this, current);
		if (this.#confirm === undefined) {
			throw refusal("ControlRequired", "no confirm channel can ask the human for foreground control", "no_confirm_channel", {
				disposition: AFTER_USER,
			});
		}
		if ((await this.#confirm(why)) !== true) {
			throw refusal("ControlRequired", "the human declined foreground control", "declined", { disposition: AFTER_USER });
		}
		const granted = await this.#link.read(
			"control.grant",
			{ reason: why, confirmationId: crypto.randomUUID() },
			parseControlState,
		);
		return new Lease(this, granted);
	}

	state(): Promise<ControlState> {
		return this.#link.read("control.state", {}, parseControlState);
	}

	async release(): Promise<void> {
		await this.#link.read("control.revoke", {}, (value) => (value === null ? null : undefined));
	}
}

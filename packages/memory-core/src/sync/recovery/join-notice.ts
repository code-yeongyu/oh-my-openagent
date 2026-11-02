import type { ChainState } from "../crypto/chain.ts";
import type { KeyringEntry } from "../crypto/entry.ts";
import { parsePrincipal } from "../crypto/parse.ts";

export const VETO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type JoinNotice =
	| { readonly kind: "not-a-join" }
	| { readonly kind: "behind" }
	| { readonly kind: "ordinary" }
	| {
			readonly kind: "foreign" | "excluded";
			readonly joinDigest: string;
			readonly prompt: "a-device-joined-using-your-passkey";
			readonly actions: readonly ["veto", "confirm"];
	  };

/** The keyring_link of this device's verified chain at `seq`: the last keyring record at or before it. */
const verifiedKeyringLinkAt = (
	state: ChainState,
	seq: number,
): string | null => {
	let link: string | null = null;
	for (const entry of state.received) {
		if (entry.seq > seq) break;
		link = entry.keyring_link;
	}
	return link;
};

/**
 * How a surviving device meets a served recovery-join (sync-design section 7). A device that is
 * merely behind verifies forward first. A join whose bound keyring head is not this device's verified
 * keyring_link at the join's base_seq, or that contradicts an entry it already holds, is foreign: a
 * fork, pushes stop, and the "a device joined using your passkey" prompt offers Veto and Confirm.
 * A join on its own verified head that leaves it outside the membership gets the same prompt.
 */
export const classifyRecoveryJoin = (
	state: ChainState,
	join: KeyringEntry,
	selfId: string,
): JoinNotice => {
	if (join.body.kind !== "recovery-join") return { kind: "not-a-join" };
	const prompt = {
		joinDigest: join.digest,
		prompt: "a-device-joined-using-your-passkey",
		actions: ["veto", "confirm"],
	} as const;
	const head = state.head;
	if (head === null || head.seq < join.base_seq) return { kind: "behind" };
	if (
		head.seq >= join.seq &&
		state.received.find((entry) => entry.seq === join.seq)?.digest !==
			join.digest
	) {
		return { kind: "foreign", ...prompt };
	}
	if (verifiedKeyringLinkAt(state, join.base_seq) !== join.body["keyring_head"])
		return { kind: "foreign", ...prompt };
	return parsePrincipal(join.body["principal"])?.id === selfId
		? { kind: "ordinary" }
		: { kind: "excluded", ...prompt };
};

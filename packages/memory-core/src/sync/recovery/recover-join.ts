import type { ChainAnchor, PinCandidate } from "../crypto/anchor.ts";
import type { ChainState } from "../crypto/chain.ts";
import type { Authority } from "../crypto/fold.ts";
import type { RecoveryKey } from "../crypto/parse.ts";
import type { RejectionCounter } from "../crypto/rejection.ts";
import type {
	RecoverBridgeResult,
	RecoveryTransport,
	TransportRefusal,
} from "./ports.ts";
import { loadServedChain } from "./served-chain.ts";

type Recovered = Extract<RecoverBridgeResult, { ok: true }>;
type Head = NonNullable<ChainState["head"]>;

export type ConfirmedJoin =
	| {
			readonly ok: true;
			readonly authority: Authority;
			readonly head: Head;
			readonly pin: PinCandidate;
			readonly usedKey: RecoveryKey;
	  }
	| {
			readonly ok: false;
			readonly reason: TransportRefusal | "join-unconfirmed";
	  };

/**
 * Appends the bridge-signed join and confirms it on a fresh anchored reload: the head must be the
 * join's keyring link and the key used must still be registered. A join the server accepted but the
 * reload does not show is `join-unconfirmed` (#10412 review L1), distinct from a refused append, so
 * the caller can say surviving members may see a join that never completed.
 */
export const appendAndConfirmJoin = async (
	transport: RecoveryTransport,
	account: string,
	rejections: RejectionCounter,
	anchor: ChainAnchor,
	head: Head,
	recovered: Recovered,
): Promise<ConfirmedJoin> => {
	const join = recovered.join;
	const joined = await transport.recoveryJoin({
		record: join.body,
		base_seq: head.seq,
		link: join.link,
		keyring_link: join.keyringLink,
		record_sig: join.recordSig,
		wraps: [],
	});
	if (!joined.ok) return { ok: false, reason: joined.reason };
	const after = await loadServedChain(transport, account, rejections, anchor);
	if (!after.ok) return { ok: false, reason: "join-unconfirmed" };
	const { authority, head: afterHead, pin } = after.state;
	const usedKey = authority?.registry.get(recovered.credentialId);
	if (
		authority === null ||
		afterHead === null ||
		pin === null ||
		usedKey === undefined ||
		afterHead.keyring_link !== join.keyringLink
	) {
		return { ok: false, reason: "join-unconfirmed" };
	}
	return { ok: true, authority, head: afterHead, pin, usedKey };
};

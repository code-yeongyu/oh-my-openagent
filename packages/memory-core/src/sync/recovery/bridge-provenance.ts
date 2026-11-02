import type { WrapEntry } from "../crypto/entry.ts";
import { wrapSetDigest } from "../crypto/links.ts";
import type { RecoveryKeyPairs } from "./derive.ts";
import {
	disposeMaterial,
	type EpochMaterial,
	openWrapWithKey,
} from "./key-material.ts";
import type { RecoverRefusal, RecoveryCandidate } from "./ports.ts";

/**
 * Which recovery wrap the reference bridge opens (desktop #2897 review r4 H2), the same rule the
 * desktop bridge enforces. The candidate carries the enrolling record's full wrap list: its digest,
 * computed by the chain's own `wrapSetDigest` (RFC 8785 over the list in served order, so the
 * binding is ORDER-SENSITIVE, and duplicate (epoch, id) entries are refused), must equal the
 * countersigned digest; every entry must share one epoch (a record's epoch) and exactly one entry
 * must be `recovery:<credential>`: that is the enrollment wrap. The candidate's wrap is opened as is
 * when it IS that wrap; a later epoch's wrap is opened only when its history carries the
 * enrollment wrap's key at the enrollment epoch. The server never learns that key, so it cannot
 * author such a wrap. Stated limit: a member removed after enrollment who still holds that key is
 * excluded only by the client's anchored walk. Every opened material except the returned one is
 * zeroed.
 */
export const provenRecoveryMaterial = async (
	account: string,
	candidate: RecoveryCandidate,
	keys: RecoveryKeyPairs,
): Promise<EpochMaterial | RecoverRefusal> => {
	const id = `recovery:${candidate.key.credential_id}`;
	const listed = candidate.enrollment.wraps;
	const digest = await wrapSetDigest(listed);
	const recoveryEntries = listed.filter((wrap) => wrap.id === id);
	const enrollmentWrap = recoveryEntries[0];
	if (
		!digest.ok ||
		digest.digest !== candidate.countersign.wrapsDigest ||
		recoveryEntries.length !== 1 ||
		enrollmentWrap === undefined ||
		listed.some((wrap) => wrap.epoch !== enrollmentWrap.epoch)
	)
		return "wrap-unbound";
	const open = async (
		wrap: WrapEntry,
		history: ReadonlyArray<readonly [number, string]>,
	): Promise<EpochMaterial | null> => {
		const opened = await openWrapWithKey(
			keys.sealPrivate,
			keys.sealPublic,
			wrap,
			{ account, epoch: wrap.epoch, id },
			new Map(history),
		);
		return opened.ok ? opened.material : null;
	};
	if (sameEntry(candidate.wrap, enrollmentWrap))
		return (
			(await open(candidate.wrap, candidate.enrollment.expectedHistory)) ??
			"wrap-refused"
		);
	if (candidate.wrap.epoch <= enrollmentWrap.epoch) return "wrap-unbound";
	const enrolled = await open(
		enrollmentWrap,
		candidate.enrollment.expectedHistory,
	);
	if (enrolled === null) return "wrap-refused";
	try {
		const later = await open(candidate.wrap, candidate.expectedHistory);
		if (later === null) return "wrap-refused";
		const atEnrollment = later.history.find(
			(row) => row.epoch === enrollmentWrap.epoch,
		);
		if (
			atEnrollment === undefined ||
			!sameKey(atEnrollment.key, enrolled.current)
		) {
			disposeMaterial(later);
			return "wrap-unbound";
		}
		return later;
	} finally {
		disposeMaterial(enrolled);
	}
};

const sameEntry = (left: WrapEntry, right: WrapEntry): boolean =>
	left.epoch === right.epoch &&
	left.id === right.id &&
	left.wrap === right.wrap;

const sameKey = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1)
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	return difference === 0;
};

import { signRecord } from "../crypto/build.ts";
import type {
	Head,
	KeyringBody,
	VerifiedWrap,
	WrapEntry,
} from "../crypto/entry.ts";
import type { Authority } from "../crypto/fold.ts";
import { nextLink, wrapSetDigest } from "../crypto/links.ts";
import type { Principal, RecoveryKey } from "../crypto/parse.ts";
import { openWrap } from "../crypto/unwrap.ts";
import { jcsBytes, sha256B64 } from "../crypto/vendor/sync-format/jcs.ts";
import type { DeviceKeyring } from "../keyring-port.ts";
import { type EpochMaterial, sealWrap } from "./key-material.ts";
import type { KeyringAppendRequest } from "./ports.ts";

/** A member-signed keyring append at `head`, linked on both chains exactly as the server admits it. */
export const signedAppend = async (
	keyring: DeviceKeyring,
	head: Head,
	body: KeyringBody,
	wraps: ReadonlyArray<WrapEntry>,
): Promise<KeyringAppendRequest> => {
	const digest = await sha256B64(jcsBytes(body));
	const link = await nextLink(head.link, digest);
	const keyringLink = await nextLink(head.keyring_link, digest);
	if (link === null || keyringLink === null)
		throw new Error("the served head does not decode");
	const fields = {
		account: body.account,
		base_seq: head.seq,
		digest,
		epoch: body.epoch,
		link,
		keyring_link: keyringLink,
	};
	return {
		record: body,
		base_seq: head.seq,
		link,
		keyring_link: keyringLink,
		record_sig: await signRecord(keyring, fields),
		wraps,
	};
};

const byId = (
	left: { readonly id: string },
	right: { readonly id: string },
): number => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/**
 * The next epoch's rotation (sync-design section 7): a fresh 256-bit key whose material carries
 * every retained earlier key (the current epoch's under its creating record), wrapped to exactly
 * the listed members and the folded recovery registry, in (epoch, id ASCII) order.
 */
export const rotationAppend = async (
	keyring: DeviceKeyring,
	head: Head,
	account: string,
	authority: Authority,
	retained: EpochMaterial,
	members: ReadonlyArray<Principal>,
	registry: ReadonlyArray<RecoveryKey>,
): Promise<KeyringAppendRequest> => {
	const epoch = authority.epoch + 1;
	const origin = authority.epochOrigins.get(authority.epoch) ?? "";
	const material: EpochMaterial = {
		epoch,
		current: crypto.getRandomValues(new Uint8Array(32)),
		history: [
			...retained.history,
			{ epoch: retained.epoch, origin, key: retained.current },
		],
	};
	const recipients = [
		...members.map((member) => ({
			id: `device:${member.id}`,
			sealing: member.sealing_public_key,
		})),
		...registry.map((key) => ({
			id: `recovery:${key.credential_id}`,
			sealing: key.sealing_public_key,
		})),
	].sort(byId);
	const wraps: WrapEntry[] = [];
	for (const recipient of recipients)
		wraps.push(
			await sealWrap(
				{ account, epoch, id: recipient.id },
				recipient.sealing,
				material,
			),
		);
	material.current.fill(0);
	const digest = await wrapSetDigest(wraps);
	if (!digest.ok)
		throw new Error("a rotation wrap set holds a duplicate recipient");
	const body = {
		kind: "rotation",
		account,
		epoch,
		members: [...members].sort(byId).map((member) => ({ ...member })),
		wraps_digest: digest.digest,
		fork_resolution: null,
	};
	return signedAppend(keyring, head, body, wraps);
};

/** This member's current-epoch material, opened only through its own DeviceKeyring from a committed wrap. */
export const ownMaterial = async (
	keyring: DeviceKeyring,
	account: string,
	wrap: VerifiedWrap,
	expected: ReadonlyArray<readonly [number, string]>,
): Promise<EpochMaterial | null> => {
	const origins = new Map(expected);
	const opened = await openWrap(keyring, wrap, account, origins);
	if (!opened.ok) return null;
	return {
		epoch: wrap.epoch,
		current: opened.keys.current,
		history: [...opened.keys.history].map(([epoch, key]) => ({
			epoch,
			origin: origins.get(epoch) ?? "",
			key,
		})),
	};
};

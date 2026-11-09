import type {
	BatchEntry,
	KeyringEntry,
	SyncAuthor,
	SyncEntry,
} from "../../crypto/entry.ts";
import { jcsBytes, sha256B64 } from "../../crypto/vendor/sync-format/jcs.ts";
import type {
	AppendResult,
	ChainRow,
	KeyringAppendRequest,
	RecoveryTransport,
	RecoveryWrapRow,
} from "../ports.ts";

/** A stored batch row with the id its sealed header carries, as the service keeps `sync_entries.batch_id`. */
export type StoredBatchRow = BatchEntry & { readonly batch_id: string };

/**
 * The `batch_id` a contract-shaped `/v1/sync/entries` row serves: the stored id on a batch row, and
 * null on a keyring row or on a batch stored without one (which the client must refuse).
 */
export const servedBatchId = (entry: SyncEntry): string | null =>
	entry.kind === "batch" &&
	"batch_id" in entry &&
	typeof entry.batch_id === "string"
		? entry.batch_id
		: null;

/**
 * An in-memory sync server for one or more accounts. It admits appends by the base check alone and
 * mirrors the two server admission rules recovery depends on (5 joins per account per hour, the
 * same 404 for another account's rows); it verifies nothing else, so every client check is real.
 */
export class FakeSyncServer {
	readonly chains = new Map<string, SyncEntry[]>();
	readonly requests: string[] = [];
	joinsThisHour = new Map<string, number>();
	servedPrefix: number | null = null;
	refuseRotations = false;

	/** A server that serves and extends only the first `length` entries: an operator hiding the rest. */
	withPrefix(account: string, length: number): FakeSyncServer {
		const stale = new FakeSyncServer();
		stale.chains.set(account, this.chain(account).slice(0, length));
		return stale;
	}

	chain(account: string): SyncEntry[] {
		const existing = this.chains.get(account);
		if (existing !== undefined) return existing;
		const created: SyncEntry[] = [];
		this.chains.set(account, created);
		return created;
	}

	served(account: string): ReadonlyArray<SyncEntry> {
		const chain = this.chain(account);
		return this.servedPrefix === null
			? chain
			: chain.slice(0, this.servedPrefix);
	}

	async admit(
		account: string,
		author: SyncAuthor,
		request: KeyringAppendRequest,
	): Promise<AppendResult> {
		this.requests.push(JSON.stringify(request));
		if (request.record.account !== account)
			return { ok: false, reason: "not_found" };
		const chain = this.chain(account);
		if (request.base_seq !== chain.length)
			return { ok: false, reason: "stale_base" };
		const entry: KeyringEntry = {
			seq: chain.length + 1,
			base_seq: request.base_seq,
			kind: "keyring",
			account,
			epoch: request.record.epoch,
			author,
			body: request.record,
			digest: await sha256B64(jcsBytes(request.record)),
			link: request.link,
			keyring_link: request.keyring_link,
			record_sig: request.record_sig,
			wraps: request.wraps,
		};
		chain.push(entry);
		return { ok: true, seq: entry.seq };
	}

	transport(account: string, author: SyncAuthor): RecoveryTransport {
		const keyringRows = (): ReadonlyArray<KeyringEntry> =>
			this.served(account).filter(
				(entry): entry is KeyringEntry => entry.kind === "keyring",
			);
		return {
			listKeys: async () => keyringRows(),
			// The contract SyncPullEntry row minus object_id and bytes: batch_id on batch rows, null on keyring rows.
			listEntries: async (): Promise<ReadonlyArray<ChainRow>> =>
				this.served(account).map((entry) => ({
					seq: entry.seq,
					base_seq: entry.base_seq,
					kind: entry.kind,
					account: entry.account,
					epoch: entry.epoch,
					author: entry.author,
					digest: entry.digest,
					link: entry.link,
					keyring_link: entry.keyring_link,
					record_sig: entry.record_sig,
					batch_id: servedBatchId(entry),
				})),
			listRecoveryWraps: async (): Promise<ReadonlyArray<RecoveryWrapRow>> =>
				keyringRows().flatMap((entry) =>
					entry.wraps
						.filter((wrap) => wrap.id.startsWith("recovery:"))
						.map((wrap) => ({
							record: {
								seq: entry.seq,
								digest: entry.digest,
								keyring_link: entry.keyring_link,
							},
							entry: wrap,
						})),
				),
			appendKeys: async (request) => {
				if (this.refuseRotations && request.record.kind === "rotation")
					return { ok: false, reason: "refused" };
				return this.admit(account, author, request);
			},
			recoveryJoin: async (request) => {
				if (request.record.account !== account)
					return { ok: false, reason: "not_found" };
				const joins = this.joinsThisHour.get(account) ?? 0;
				if (joins >= 5) return { ok: false, reason: "rate_limited" };
				const credential = request.record["credential_id"];
				const admitted = await this.admit(
					account,
					{
						kind: "recovery",
						credential_id: typeof credential === "string" ? credential : "",
					},
					request,
				);
				if (admitted.ok) this.joinsThisHour.set(account, joins + 1);
				return admitted;
			},
		};
	}
}

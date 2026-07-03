import { evaluate } from "./evaluate.ts";
import { createLocalEventEmitter, type PermissionEventEmitter } from "./events.ts";
import {
	CorrectedError,
	DeniedError,
	type PendingEntry,
	RejectedError,
	type ReplyInput,
	type Request,
	type Ruleset,
} from "./types.ts";

type RequestInput = Omit<Request, "id"> & { id?: string };

/** Core service for managing permission requests and rule evaluation */
export class PermissionService {
	private pending = new Map<string, PendingEntry>();
	private approved: Ruleset;
	private staticRuleset: Ruleset;
	private emitter: PermissionEventEmitter;
	private idCounter = 0;

	constructor(staticRuleset: Ruleset, approved: Ruleset, emitter: PermissionEventEmitter = createLocalEventEmitter()) {
		this.staticRuleset = [...staticRuleset];
		this.approved = [...approved];
		this.emitter = emitter;
	}

	/** Request permission for a tool call. Resolves if allowed, throws on denial. */
	async ask(request: RequestInput): Promise<void> {
		const info: Request = {
			...request,
			id: request.id ?? this.nextRequestID(),
		};

		const deniedPatterns: string[] = [];
		let needsAsk = false;

		for (const pattern of info.patterns) {
			const rule = evaluate(info.permission, pattern, this.staticRuleset, this.approved);

			if (rule.action === "deny") {
				deniedPatterns.push(pattern);
				continue;
			}

			if (rule.action === "ask") {
				needsAsk = true;
			}
		}

		if (deniedPatterns.length > 0) {
			throw new DeniedError(deniedPatterns);
		}

		if (!needsAsk) {
			this.emitter.emitReplied(info.id, info.sessionID, "allow");
			return;
		}

		const pendingPromise = new Promise<void>((resolve, reject) => {
			const pendingEntry: PendingEntry = {
				info,
				resolve: () => {
					this.pending.delete(info.id);
					resolve();
				},
				reject: (error) => {
					this.pending.delete(info.id);
					reject(error);
				},
			};

			this.pending.set(info.id, pendingEntry);
		});

		this.emitter.emitAsked(info);

		await pendingPromise;
	}

	/** Reply to a pending permission request */
	reply(input: ReplyInput): void {
		const existing = this.pending.get(input.requestID);
		if (!existing) {
			return;
		}

		this.pending.delete(input.requestID);
		this.emitter.emitReplied(existing.info.id, existing.info.sessionID, input.reply);

		if (input.reply === "reject") {
			existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError());
			this.rejectPendingInSession(existing.info.sessionID);
			return;
		}

		existing.resolve();

		if (input.reply === "once") {
			return;
		}

		for (const pattern of existing.info.always) {
			this.approved.push({
				permission: existing.info.permission,
				pattern,
				action: "allow",
			});
		}

		this.resolveCoveredPendingInSession(existing.info.sessionID);
	}

	/** List all pending permission requests */
	list(): Request[] {
		return Array.from(this.pending.values(), (entry) => ({
			...entry.info,
			patterns: [...entry.info.patterns],
			always: [...entry.info.always],
			metadata: { ...entry.info.metadata },
			tool: entry.info.tool ? { ...entry.info.tool } : undefined,
		}));
	}

	/** Get the current approved ruleset */
	getApproved(): Ruleset {
		return this.approved.map((rule) => ({ ...rule }));
	}

	private nextRequestID(): string {
		this.idCounter += 1;
		return `permission-${this.idCounter}`;
	}

	private rejectPendingInSession(sessionID: string): void {
		for (const [requestID, entry] of Array.from(this.pending.entries())) {
			if (entry.info.sessionID !== sessionID) {
				continue;
			}

			this.pending.delete(requestID);
			this.emitter.emitReplied(entry.info.id, entry.info.sessionID, "reject");
			entry.reject(new RejectedError());
		}
	}

	private resolveCoveredPendingInSession(sessionID: string): void {
		for (const [requestID, entry] of Array.from(this.pending.entries())) {
			if (entry.info.sessionID !== sessionID) {
				continue;
			}

			const isAllowed = entry.info.patterns.every((pattern) => {
				return evaluate(entry.info.permission, pattern, this.staticRuleset, this.approved).action === "allow";
			});

			if (!isAllowed) {
				continue;
			}

			this.pending.delete(requestID);
			this.emitter.emitReplied(entry.info.id, entry.info.sessionID, "always");
			entry.resolve();
		}
	}
}

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../shared";
import { getDataDir } from "../shared/data-path";

function getDbPath(): string {
	return join(getDataDir(), "opencode", "opencode.db");
}

const MAX_MICROTASK_RETRIES = 10;

function tryUpdateMessageModel(
	db: InstanceType<typeof Database>,
	messageId: string,
	targetModel: { providerID: string; modelID: string },
	variant?: string,
): boolean {
	const stmt = db.prepare(
		`UPDATE message SET data = json_set(data, '$.model.providerID', ?, '$.model.modelID', ?) WHERE id = ?`,
	);
	const result = stmt.run(
		targetModel.providerID,
		targetModel.modelID,
		messageId,
	);
	stmt.finalize();
	if (result.changes === 0) return false;
	if (variant) {
		const variantStmt = db.prepare(
			`UPDATE message SET data = json_set(data, '$.variant', ?, '$.thinking', ?) WHERE id = ?`,
		);
		variantStmt.run(variant, variant, messageId);
		variantStmt.finalize();
	}
	return true;
}

function retryViaMicrotask(
	dbPath: string,
	messageId: string,
	targetModel: { providerID: string; modelID: string },
	variant: string | undefined,
	attempt: number,
): void {
	if (attempt >= MAX_MICROTASK_RETRIES) {
		log(
			"[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout",
			{
				messageId,
				attempt,
			},
		);
		setTimeout(() => {
			let db: InstanceType<typeof Database> | undefined;
			try {
				db = new Database(dbPath);
				if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
					log(
						`[ultrawork-db-override] setTimeout fallback succeeded: ${targetModel.providerID}/${targetModel.modelID}`,
						{ messageId },
					);
				} else {
					log(
						"[ultrawork-db-override] setTimeout fallback failed - message not found",
						{
							messageId,
						},
					);
				}
			} catch (error) {
				log("[ultrawork-db-override] setTimeout fallback failed with error", {
					messageId,
					error: String(error),
				});
			} finally {
				if (db) {
					try {
						db.close();
					} catch (error) {
						log(
							"[ultrawork-db-override] Failed to close DB after setTimeout fallback",
							{
								messageId,
								error: String(error),
							},
						);
					}
				}
			}
		}, 0);
		return;
	}

	queueMicrotask(() => {
		let db: InstanceType<typeof Database> | undefined;

		try {
			db = new Database(dbPath);

			if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
				log(
					`[ultrawork-db-override] Deferred DB update (attempt ${attempt}): ${targetModel.providerID}/${targetModel.modelID}`,
					{ messageId },
				);
				return;
			}

			retryViaMicrotask(dbPath, messageId, targetModel, variant, attempt + 1);
		} catch (error) {
			log("[ultrawork-db-override] Deferred DB update failed with error", {
				messageId,
				attempt,
				error: String(error),
			});
		} finally {
			if (db) {
				try {
					db.close();
				} catch (error) {
					log(
						"[ultrawork-db-override] Failed to close DB after deferred DB update",
						{
							messageId,
							attempt,
							error: String(error),
						},
					);
				}
			}
		}
	});
}

/**
 * Schedules a deferred SQLite update to change the message model in the DB
 * WITHOUT triggering a Bus event. Uses microtask retry loop to wait for
 * Session.updateMessage() to save the message first, then overwrites the model.
 *
 * Falls back to setTimeout(fn, 0) after 10 microtask attempts.
 */
export function scheduleDeferredModelOverride(
	messageId: string,
	targetModel: { providerID: string; modelID: string },
	variant?: string,
): void {
	queueMicrotask(() => {
		const dbPath = getDbPath();
		if (!existsSync(dbPath)) {
			log("[ultrawork-db-override] DB not found, skipping deferred override");
			return;
		}

		retryViaMicrotask(dbPath, messageId, targetModel, variant, 0);
	});
}

import { type UlwLoopScope } from "./paths.js";
import type { UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
export declare function withUlwLoopMutationLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T>;
export declare function withUlwLoopMutationLock<T>(repoRoot: string, scope: UlwLoopScope | undefined, fn: () => Promise<T>): Promise<T>;
export declare function readUlwLoopPlan(repoRoot: string, scope?: UlwLoopScope): Promise<UlwLoopPlan>;
export declare function writePlan(repoRoot: string, plan: UlwLoopPlan, scope?: UlwLoopScope): Promise<void>;
export declare function appendLedger(repoRoot: string, entry: UlwLoopLedgerEntry, scope?: UlwLoopScope): Promise<void>;
export declare function appendLedgerEntries(repoRoot: string, entries: readonly UlwLoopLedgerEntry[], scope?: UlwLoopScope): Promise<void>;
export declare function readSteeringLedgerEntries(repoRoot: string, scope?: UlwLoopScope): Promise<UlwLoopLedgerEntry[]>;
/**
 * First accepted steering entry matching an idempotency key/prompt signature.
 * A cheap substring probe on the raw line skips JSON.parse for the vast
 * majority of entries, so dedup stays flat even on legacy multi-MB ledgers.
 */
export declare function findAcceptedSteeringLedgerEntry(repoRoot: string, key: string, scope?: UlwLoopScope): Promise<UlwLoopLedgerEntry | undefined>;

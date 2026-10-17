export type PullRequestReference = { owner: string; repo: string; number: number; key: string }
export type FingerprintBatch = { refs: PullRequestReference[]; query: string }
export type FingerprintRow = {
  key: string; result: "ok" | "unreadable" | "rate_limited";
  refreshStatus: boolean; refreshRemarks: boolean;
  statusFingerprint?: string; remarksFingerprint?: string;
  checksRunning?: boolean; state?: string; url?: string; lastRemarksReadAt?: number | null;
}
export type FingerprintBaseline = Record<string, { statusFingerprint?: string; remarksFingerprint?: string; lastRemarksReadAt?: number | null }>
export function parsePullRequest(value: string): PullRequestReference
export function buildBatches(keys: string[]): FingerprintBatch[]
export function decodeBatch(batch: FingerprintBatch, response: unknown, previous?: FingerprintBaseline, now?: number): {
  rateLimit: { cost?: number; remaining?: number; resetAt?: string } | null;
  errors: unknown[]; rows: FingerprintRow[];
}

/**
 * Cross-system memory aggregator for MetaGovernor.
 *
 * PR 2 of 8. Reads from all three memory systems (agentmemory, magic-context,
 * boulder-state) in parallel and returns a `MemoryRead` that conforms to the
 * PR 1 contract (types.ts).
 *
 * Design choices:
 * - Parallel reads with per-source timeouts. No sequential I/O.
 * - Graceful degrade: a failing source does NOT fail the whole read.
 *   It populates `degradedSources[]` (string tags per the contract) and
 *   the caller (`score()`) can decide the policy.
 * - Lessons are sorted by confidence DESC. Slots by label. Tasks by priority
 *   ASC then recency DESC.
 * - Result is bounded: respects `limits`.
 * - Per-source error messages are stored separately (`errorMessages`) for
 *   debugging but NOT in the contract type (the contract only has the string tags).
 *
 * Future PRs that wire this:
 * - PR 3 (closed-loop): calls `aggregateRead()` from `observeErrorAndLearn`
 *   and `preflightCheck`.
 * - PR 5 (score): calls `aggregateRead()` to build `lessonsRelevant` slice
 *   of `DecisionContext`.
 * - PR 6 (post-repair): calls `aggregateRead()` after a fix to verify.
 *
 * Internal raw types (Lesson, Crystal, Slot, BoulderTask) are defined here
 * as private interfaces representing what each backend actually returns.
 * The aggregator maps them to the contract types from types.ts.
 */

import type {
  MemoryRead,
  MemorySource,
  RelevantLesson,
} from "./types";

// ---------------------------------------------------------------------------
// Raw backend types (private to this module — NOT exported to the contract)

interface RawLesson {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly type: string;
  readonly concepts: readonly string[];
  readonly confidence: number;
  readonly files: readonly string[];
}

interface RawCrystal {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly type: string;
  readonly concepts: readonly string[];
  readonly confidence: number;
  readonly files: readonly string[];
}

interface RawSlot {
  readonly label: string;
  readonly content: string;
  readonly pinned?: boolean;
  readonly scope?: string;
  readonly sizeLimit?: number;
  readonly updatedAt?: number;
}

interface RawBoulderTask {
  readonly id: string;
  readonly title: string;
  readonly priority: number;
  readonly status: string;
  readonly description: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// Backend ports (interfaces). Implementations are injected; tests use fakes.

export interface AgentmemoryBackend {
  smartSearch(input: { query: string; limit?: number }): Promise<{ lessons: RawLesson[]; crystals: RawCrystal[] }>;
}

export interface MagicContextBackend {
  slotList(input: { directory?: string; labelPrefix?: string }): Promise<RawSlot[]>;
}

export interface BoulderStateBackend {
  boulderRead(input: { directory: string; sessionID: string; query?: string }): Promise<RawBoulderTask[]>;
}

// ---------------------------------------------------------------------------
// Aggregate read input

export interface AggregateReadInput {
  /** Working directory. Scopes the read. */
  readonly directory: string;
  /** Session ID. Used for boulder-state keying. */
  readonly sessionID: string;
  /** Natural-language query. Passed to agentmemory (semantic) and boulder. */
  readonly query: string;
  /** Result-size bounds. */
  readonly limits?: {
    readonly maxLessons?: number;
    readonly maxSlots?: number;
    readonly maxTasks?: number;
  };
  /** Per-source timeout in ms. Default 2000 for agentmemory (network), 1000 for local. */
  readonly timeouts?: {
    readonly agentmemoryMs?: number;
    readonly magicContextMs?: number;
    readonly boulderStateMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Extended result (conforms to MemoryRead + adds metadata for debugging)

export interface AggregateReadResult extends MemoryRead {
  /** Wall-clock duration of the whole read, in ms. */
  readonly durationMs: number;
  /** Per-source error messages (for debugging; not in the contract type). */
  readonly errorMessages: Partial<Record<MemorySource, string>>;
}

// ---------------------------------------------------------------------------
// Backends

export interface Backends {
  agentmemory: AgentmemoryBackend;
  magicContext: MagicContextBackend;
  boulderState: BoulderStateBackend;
}

const DEFAULTS = {
  limits: { maxLessons: 10, maxSlots: 20, maxTasks: 10 },
  timeouts: { agentmemoryMs: 2000, magicContextMs: 1000, boulderStateMs: 1000 },
} as const;

/**
 * Read from all three memory systems in parallel. Never throws — a failing
 * source populates `degradedSources` and the read still returns a valid result.
 */
export async function aggregateRead(
  input: AggregateReadInput,
  backends: Backends,
): Promise<AggregateReadResult> {
  const start = performance.now();
  const limits = { ...DEFAULTS.limits, ...input.limits };
  const timeouts = { ...DEFAULTS.timeouts, ...input.timeouts };

  const [agentResult, magicResult, boulderResult] = await Promise.allSettled([
    readAgentmemory(input, backends.agentmemory, limits, timeouts.agentmemoryMs),
    readMagicContext(input, backends.magicContext, limits, timeouts.magicContextMs),
    readBoulderState(input, backends.boulderState, limits, timeouts.boulderStateMs),
  ]);

  const degradedSources: MemorySource[] = [];
  const errorMessages: Partial<Record<MemorySource, string>> = {};

  const agentmemory = agentResult.status === "fulfilled"
    ? agentResult.value
    : (pushDegraded(degradedSources, errorMessages, "agentmemory", errorMessage(agentResult.reason)), DEGRADED.agentmemory);

  const magicContext = magicResult.status === "fulfilled"
    ? magicResult.value
    : (pushDegraded(degradedSources, errorMessages, "magicContext", errorMessage(magicResult.reason)), DEGRADED.magicContext);

  const boulderState = boulderResult.status === "fulfilled"
    ? boulderResult.value
    : (pushDegraded(degradedSources, errorMessages, "boulderState", errorMessage(boulderResult.reason)), DEGRADED.boulderState);

  return {
    query: input.query,
    timestampISO: new Date().toISOString(),
    agentmemory,
    magicContext,
    boulderState,
    degradedSources,
    durationMs: performance.now() - start,
    errorMessages,
  };
}

// ---------------------------------------------------------------------------
// Source readers

async function readAgentmemory(
  input: AggregateReadInput,
  backend: AgentmemoryBackend,
  limits: Required<NonNullable<AggregateReadInput["limits"]>>,
  timeoutMs: number,
): Promise<MemoryRead["agentmemory"]> {
  const search = await withTimeout(
    backend.smartSearch({ query: input.query, limit: limits.maxLessons }),
    timeoutMs,
    "agentmemory",
  );

  const lessons: RelevantLesson[] = sortByConfidence(search.lessons)
    .slice(0, limits.maxLessons)
    .map((l) => ({
      id: l.id,
      title: l.title,
      advice: "info" as const,
      confidence: l.confidence,
      concepts: l.concepts,
    }));

  return {
    available: true,
    lessons,
  };
}

async function readMagicContext(
  input: AggregateReadInput,
  backend: MagicContextBackend,
  limits: Required<NonNullable<AggregateReadInput["limits"]>>,
  timeoutMs: number,
): Promise<MemoryRead["magicContext"]> {
  const slots = await withTimeout(
    backend.slotList({ directory: input.directory }),
    timeoutMs,
    "magicContext",
  );

  return {
    available: true,
    slots: slots
      .filter((s) => s.label.startsWith("meta_governor:") || isRelevant(s, input.query))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, limits.maxSlots)
      .map((s) => ({ label: s.label, content: s.content })),
  };
}

async function readBoulderState(
  input: AggregateReadInput,
  backend: BoulderStateBackend,
  limits: Required<NonNullable<AggregateReadInput["limits"]>>,
  timeoutMs: number,
): Promise<MemoryRead["boulderState"]> {
  const tasks = await withTimeout(
    backend.boulderRead({ directory: input.directory, sessionID: input.sessionID, query: input.query }),
    timeoutMs,
    "boulderState",
  );

  const sorted = tasks
    .sort((a, b) => a.priority - b.priority || b.updatedAtMs - a.updatedAtMs)
    .slice(0, limits.maxTasks);

  return {
    available: true,
    tasks: sorted.map((t) => ({ id: t.id, status: t.status, title: t.title })),
    planProgress: computePlanProgress(tasks),
  };
}

// ---------------------------------------------------------------------------
// Helpers

function sortByConfidence(lessons: RawLesson[]): RawLesson[] {
  return [...lessons].sort((a, b) => b.confidence - a.confidence);
}

function isRelevant(slot: RawSlot, query: string): boolean {
  const q = query.toLowerCase();
  return slot.label.toLowerCase().includes(q) || slot.content.toLowerCase().includes(q);
}

function computePlanProgress(tasks: RawBoulderTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === "done").length;
  return done / tasks.length;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

function pushDegraded(
  list: MemorySource[],
  errorMessages: Partial<Record<MemorySource, string>>,
  source: MemorySource,
  reason: string,
): void {
  list.push(source);
  errorMessages[source] = reason;
}

// Typed fallback values for degraded sources.
// These match the contract types exactly — pushDegraded is side-effect only.
const DEGRADED = {
  agentmemory: { available: false, lessons: [] } as const satisfies MemoryRead["agentmemory"],
  magicContext: { available: false, slots: [] } as const satisfies MemoryRead["magicContext"],
  boulderState: { available: false, tasks: [], planProgress: 0 } as const satisfies MemoryRead["boulderState"],
} as const;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

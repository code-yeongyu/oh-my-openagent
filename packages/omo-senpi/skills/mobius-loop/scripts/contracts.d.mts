export type Focus = "discover" | "decide" | "deliver";
export type Role = "affected" | "stakeholder" | "decider" | "executor";
export type Person = { name: string; role: Role };
export type Outcome = { type: "outcome"; id: string; statement: string; baseline?: string; target?: string; measure?: string };
export type Option = { type: "option"; id: string; title: string; hypothesis: string; tradeoffs: string[]; outcomeIds: string[]; supersedes?: string };
export type Decision = { type: "decision"; optionId: string; rationale: string; decidedBy: string; refs: string[] };
export type Experiment = { type: "experiment"; id: string; optionId: string; plan: string; passCriteria: string; deliveryRef?: { kind: "ulw-loop"; sessionId: string; goalId: string } };
export type Delivery = { type: "delivery"; experimentId: string; output: string; checks: { name: string; status: "pass" | "fail" | "blocked"; evidence: string[] }[]; refs: string[] };
export type Evidence = { type: "evidence"; id: string; experimentId: string; kind: "measurement" | "feedback" | "technical"; provenance: "observed" | "simulated" | "inferred"; source: { actor: string; role: Role }; summary: string; refs: string[]; outcomeId?: string };
export type Resolution = { outcomeId: string; status: "achieved" | "not_achieved" | "unmeasured" | "irrelevant"; evidenceIds: string[] };
export type Assessment = { type: "assessment"; experimentId: string; validity: "valid" | "invalid" | "unknown"; hypothesisSupport: "supported" | "contradicted" | "inconclusive"; outcomes: Resolution[]; learning: string; nextAction: string };
export type Foundation = { type: "foundation"; id: string; area: "culture" | "collaboration" | "technical"; note: string; owner: string; status: "open" | "done"; refs: string[] };
export type Context = { type: "context"; problem: string; people: Person[]; unknowns: string[] };
export type Closure = { type: "close"; reason: string; resolution: "achieved" | "irrelevant" | "stopped"; evidenceIds: string[] };
export type Event = Context | Outcome | Option | Decision | Experiment | Delivery | Evidence | Assessment | Foundation | Closure
  | { type: "focus"; to: Focus; reason: string; refs: string[] }
  | { type: "pause" | "resume"; reason: string };
export type HistoryEntry = { revision: number; at: string; event: Event };
export type Snapshot = { schemaVersion: 1; slug: string; title: string; initialFocus: Focus; revision: number; events: HistoryEntry[] };
export type Records = {
  context: Context | null;
  outcomes: Outcome[];
  options: Option[];
  decisions: Decision[];
  experiments: Experiment[];
  deliveries: Delivery[];
  evidence: Evidence[];
  assessments: Assessment[];
  foundation: Foundation[];
  selectedOptionId: string | null;
  focus: Focus;
  lifecycle: "active" | "paused" | "closed";
  closure: Closure | null;
};
export type Status = { snapshot: Snapshot; records: Records; gaps: string[]; nextActions: string[] };
export type ErrorCode = "INVALID_INPUT" | "UNSAFE_PATH" | "NOT_FOUND" | "MALFORMED_STATE" | "REVISION_CONFLICT" | "BUSY" | "INVALID_TRANSITION" | "IO_ERROR";
export type Envelope<T> = { ok: true; operation: string; result: T; nextActions: string[] }
  | { ok: false; operation: string; error: { code: ErrorCode; message: string } };
export type Field = string | { optional: Field } | { array: Field } | { object: Record<string, Field> };
export type Help = { moduleUrl: string; methods: Record<string, Record<string, Field>>; events: Record<string, Record<string, Field>> };
export interface Mobius {
  start(input: { title: string; focus?: Focus }): Promise<Envelope<Status>>;
  status(): Promise<Envelope<Status>>;
  record(input: { expectedRevision: number; event: Event }): Promise<Envelope<Status>>;
  learning(input: { experimentId: string }): Promise<Envelope<{ description: string; body: string }>>;
  help(): Promise<Envelope<Help>>;
}

import { describe, expect, test } from "bun:test"

import { type Action, type ActionDetail, type Actor, decide, type SessionAuthority } from "./decide"
import { ROLES, type Role } from "./roles"

// Every cell of the plan's decision table is derived from behavior, not from the table data:
// each row has probe situations, `decide()` answers each probe, and the answer string
// (Y/N per probe) is both the per-cell assertion and the key that renders the cell's text.
// The printed matrix therefore equals the plan's decision table only if decide() behaves as it says.

const ACTOR = "u_000ACTOR"
const OTHER = "u_000OTHER"
const OWNED: SessionAuthority = { owner_user_id: ACTOR, collaborator_user_ids: [] }
const COLLABORATING: SessionAuthority = { owner_user_id: OTHER, collaborator_user_ids: [ACTOR] }
const FOREIGN: SessionAuthority = { owner_user_id: OTHER, collaborator_user_ids: [] }

type Probe = { readonly name: string; readonly session: SessionAuthority | null; readonly detail?: ActionDetail }

const human = (role: Role): Actor => ({ principal: "human", user_id: ACTOR, role })
const ANYONE: readonly Probe[] = [{ name: "any chat member", session: null }]
const SESSION_RELATION: readonly Probe[] = [
  { name: "session owner", session: OWNED },
  { name: "collaborator", session: COLLABORATING },
  { name: "neither", session: FOREIGN },
]

/**
 * A row of the plan's decision table. `close_transfer_session` renders as two rows - decided
 * 2026-09-29: a session owner may close but not transfer; only a scope owner transfers.
 */
type RowId = Exclude<Action, "close_transfer_session"> | "close_own_session" | "transfer_a_session"

/** The `decide()` action each row probes: both close/transfer rows probe `close_transfer_session`. */
const ROW_ACTION: Readonly<Record<RowId, Action>> = {
  talk: "talk",
  open_work_item: "open_work_item",
  steer_session: "steer_session",
  answer_question: "answer_question",
  approve_risky_tool: "approve_risky_tool",
  bind_thread: "bind_thread",
  invite_collaborator: "invite_collaborator",
  close_own_session: "close_transfer_session",
  transfer_a_session: "close_transfer_session",
  set_rule: "set_rule",
  grant_role: "grant_role",
}

/**
 * The shared close/transfer probe set: the signature records the close AND the transfer answer,
 * and each row's phrase table reads out of it the half it renders.
 */
const CLOSE_TRANSFER_PROBES: readonly Probe[] = [
  { name: "session owner, close", session: OWNED, detail: { session_op: "close" } },
  { name: "session owner, transfer", session: OWNED, detail: { session_op: "transfer" } },
  { name: "collaborator, close", session: COLLABORATING, detail: { session_op: "close" } },
  { name: "neither, transfer", session: FOREIGN, detail: { session_op: "transfer" } },
]

const PROBES: Readonly<Record<RowId, readonly Probe[]>> = {
  talk: ANYONE,
  open_work_item: ANYONE,
  steer_session: SESSION_RELATION,
  answer_question: [
    { name: "asked user", session: FOREIGN, detail: { asked_user_id: ACTOR } },
    { name: "session owner", session: OWNED, detail: { asked_user_id: OTHER } },
    { name: "neither", session: FOREIGN, detail: { asked_user_id: OTHER } },
  ],
  approve_risky_tool: [
    { name: "owner, low", session: OWNED, detail: { risk: "low" } },
    { name: "owner, medium", session: OWNED, detail: { risk: "medium" } },
    { name: "owner, high", session: OWNED, detail: { risk: "high" } },
    { name: "not owner, medium", session: FOREIGN, detail: { risk: "medium" } },
  ],
  bind_thread: ANYONE,
  invite_collaborator: SESSION_RELATION,
  close_own_session: CLOSE_TRANSFER_PROBES,
  transfer_a_session: CLOSE_TRANSFER_PROBES,
  set_rule: [
    { name: "user rule, self", session: null, detail: { rule_target: { kind: "user", user_id: ACTOR } } },
    { name: "user rule, someone else", session: null, detail: { rule_target: { kind: "user", user_id: OTHER } } },
    { name: "thread they own", session: null, detail: { rule_target: { kind: "thread", owner_user_id: ACTOR } } },
    { name: "thread someone else owns", session: null, detail: { rule_target: { kind: "thread", owner_user_id: OTHER } } },
    { name: "channel", session: null, detail: { rule_target: { kind: "channel" } } },
    { name: "scope-wide", session: null, detail: { rule_target: { kind: "scope" } } },
  ],
  grant_role: [
    { name: "grant member in TUI", session: null, detail: { via: "tui", grant: { kind: "role", role: "member" } } },
    { name: "grant member in DM", session: null, detail: { via: "dm", grant: { kind: "role", role: "member" } } },
    { name: "grant member in a group chat", session: null, detail: { via: "group", grant: { kind: "role", role: "member" } } },
    { name: "link code for another user in DM", session: null, detail: { via: "dm", grant: { kind: "link_code", for_user_id: OTHER } } },
  ],
}

const PHRASES: Readonly<Record<RowId, Readonly<Record<string, string>>>> = {
  talk: { N: 'no (dropped; one "not linked" DM reply per 24 h)', Y: "yes" },
  open_work_item: { N: "no", Y: "yes" },
  steer_session: { NNN: "no", YNN: "session owner only", YYN: "session owner or collaborator", YYY: "yes" },
  answer_question: { NNN: "no", YYN: "the asked user or session owner", YYY: "yes" },
  approve_risky_tool: { NNNN: "no", YYNN: "session owner, medium risk", YYYY: "yes, any" },
  bind_thread: { N: "no", Y: "yes" },
  invite_collaborator: { NNN: "no", YNN: "session owner only", YYY: "yes" },
  // Decided 2026-09-29: a session owner may close but not transfer; only a scope owner transfers.
  close_own_session: { NNNN: "no", YNNN: "session owner", YYYY: "yes" },
  transfer_a_session: { NNNN: "no", YNNN: "scope owner only", YYYY: "yes" },
  set_rule: { NNNNNN: "no", YNYNNN: "self / thread they own / no / no", YNYYYN: "self / yes / yes / no", YYYYYY: "all" },
  grant_role: { NNNN: "no", YYNY: "yes (TUI or 1:1 DM only, never above own role)" },
}

const EXPECTED: Readonly<Record<RowId, Readonly<Record<Role, string>>>> = {
  talk: { guest: "N", member: "Y", trusted: "Y", owner: "Y" },
  open_work_item: { guest: "N", member: "Y", trusted: "Y", owner: "Y" },
  steer_session: { guest: "NNN", member: "YNN", trusted: "YYN", owner: "YYY" },
  answer_question: { guest: "NNN", member: "YYN", trusted: "YYN", owner: "YYY" },
  approve_risky_tool: { guest: "NNNN", member: "NNNN", trusted: "YYNN", owner: "YYYY" },
  bind_thread: { guest: "N", member: "N", trusted: "Y", owner: "Y" },
  invite_collaborator: { guest: "NNN", member: "YNN", trusted: "YNN", owner: "YYY" },
  close_own_session: { guest: "NNNN", member: "YNNN", trusted: "YNNN", owner: "YYYY" },
  transfer_a_session: { guest: "NNNN", member: "YNNN", trusted: "YNNN", owner: "YYYY" },
  set_rule: { guest: "NNNNNN", member: "YNYNNN", trusted: "YNYYYN", owner: "YYYYYY" },
  grant_role: { guest: "NNNN", member: "NNNN", trusted: "NNNN", owner: "YYNY" },
}

const PLAN_TABLE: readonly { readonly rowId: RowId; readonly row: string }[] = [
  { rowId: "talk", row: '| talk in a chat where the gateway is present (delivery `follow_up` or `auto`) | no (dropped; one "not linked" DM reply per 24 h) | yes | yes | yes |' },
  { rowId: "open_work_item", row: "| open a work item | no | yes | yes | yes |" },
  { rowId: "steer_session", row: "| steer / interrupt a session | no | session owner only | session owner or collaborator | yes |" },
  { rowId: "answer_question", row: "| answer a relayed question (`thread_answer`) | no | the asked user or session owner | same | yes |" },
  { rowId: "approve_risky_tool", row: "| approve a risky tool use | no | no | session owner, medium risk | yes, any |" },
  { rowId: "bind_thread", row: "| bind / unbind / rebind a chat thread | no | no | yes | yes |" },
  { rowId: "invite_collaborator", row: "| invite / uninvite a collaborator on a session | no | session owner only | session owner only | yes |" },
  { rowId: "close_own_session", row: "| close own session | no | session owner | session owner | yes |" },
  { rowId: "transfer_a_session", row: "| transfer a session | no | scope owner only | scope owner only | yes |" },
  { rowId: "set_rule", row: "| set a rule: user (self) / thread / channel / scope-wide | no | self / thread they own / no / no | self / yes / yes / no | all |" },
  { rowId: "grant_role", row: "| grant roles, link codes for others | no | no | no | yes (TUI or 1:1 DM only, never above own role) |" },
]

const ROW_LABELS: Readonly<Record<RowId, string>> = {
  talk: "talk in a chat where the gateway is present (delivery `follow_up` or `auto`)",
  open_work_item: "open a work item",
  steer_session: "steer / interrupt a session",
  answer_question: "answer a relayed question (`thread_answer`)",
  approve_risky_tool: "approve a risky tool use",
  bind_thread: "bind / unbind / rebind a chat thread",
  invite_collaborator: "invite / uninvite a collaborator on a session",
  close_own_session: "close own session",
  transfer_a_session: "transfer a session",
  set_rule: "set a rule: user (self) / thread / channel / scope-wide",
  grant_role: "grant roles, link codes for others",
}

function signature(rowId: RowId, role: Role): string {
  return PROBES[rowId].map((probe) => (decide(human(role), ROW_ACTION[rowId], probe.session, probe.detail).allow ? "Y" : "N")).join("")
}

function phrase(rowId: RowId, role: Role): string {
  const sig = signature(rowId, role)
  return PHRASES[rowId][sig] ?? `UNMAPPED(${sig})`
}

function renderRow(rowId: RowId): string {
  const cells = ROLES.map((role) => phrase(rowId, role))
  // The plan abbreviates the trusted cell of the answer row as "same" (as member).
  if (rowId === "answer_question" && cells[2] === cells[1]) cells[2] = "same"
  return `| ${ROW_LABELS[rowId]} | ${cells.join(" | ")} |`
}

describe("decision table: one test per cell (11 rows x 4 roles)", () => {
  for (const { rowId } of PLAN_TABLE) {
    for (const role of ROLES) {
      const probes = PROBES[rowId].map((probe) => probe.name).join(", ")
      test(`${rowId} x ${role} = ${PHRASES[rowId][EXPECTED[rowId][role]]} [${probes}]`, () => {
        expect(signature(rowId, role)).toBe(EXPECTED[rowId][role])
      })
    }
  }
})

describe("decision table: rendered matrix equals the plan's decision table", () => {
  for (const { rowId, row } of PLAN_TABLE) {
    test(`row ${rowId}`, () => {
      expect(renderRow(rowId)).toBe(row)
    })
  }

  test("prints the 11x4 matrix", () => {
    const lines = ["| Action | guest | member | trusted | owner |", "| --- | --- | --- | --- | --- |", ...PLAN_TABLE.map(({ rowId }) => renderRow(rowId))]
    console.log(`DECISION MATRIX (derived from decide())\n${lines.join("\n")}`)
    expect(lines).toHaveLength(13)
  })
})

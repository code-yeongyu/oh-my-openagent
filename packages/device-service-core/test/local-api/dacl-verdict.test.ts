import { describe, expect, test } from "bun:test";
import { applyExactDacl, exactDaclVerdict, parseSddl } from "../../src/local-api/dacl.ts";
import { rejectionOf } from "./conformance/rejection.ts";

const U = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const FILE = `O:${U}D:PAI(A;;FA;;;${U})`;
const DIR = `O:${U}D:PAI(A;OICI;FA;;;${U})`;
const verdict = (sddl: string, kind: "dir" | "file" = "file"): boolean => {
  const dacl = parseSddl(sddl);
  return dacl !== undefined && exactDaclVerdict(dacl, U, kind);
};

describe("the exact DACL verdict over the raw SDDL", () => {
  test("exactly one protected allow ACE with full access for the owner passes", () => {
    expect(verdict(FILE, "file")).toBe(true);
    expect(verdict(DIR, "dir")).toBe(true);
  });

  test("a conditional (callback) allow ACE next to the owner's is refused, and the parser keeps it", () => {
    const sddl = `${FILE}(XA;;FA;;;WD;(Member_of {SID(BA)}))`;
    expect(parseSddl(sddl)?.aces.map((ace) => ace.type)).toEqual(["A", "XA"]);
    expect(verdict(sddl)).toBe(false);
  });

  test("an object ACE is refused", () => {
    expect(verdict(`${FILE}(OA;;FA;bf967a86-0de6-11d0-a285-00aa003049e2;;WD)`)).toBe(false);
    expect(verdict(`O:${U}D:PAI(OA;;FA;bf967a86-0de6-11d0-a285-00aa003049e2;;${U})`)).toBe(false);
  });

  test("a deny ACE is refused", () => {
    expect(verdict(`O:${U}D:PAI(D;;FA;;;WD)(A;;FA;;;${U})`)).toBe(false);
    expect(verdict(`O:${U}D:PAI(D;;FA;;;${U})`)).toBe(false);
  });

  test("a second allow ACE is refused", () => {
    expect(verdict(`${FILE}(A;;FR;;;WD)`)).toBe(false);
    expect(verdict(`${FILE}(A;;FA;;;${U})`)).toBe(false);
  });

  test("a DACL without the P flag is refused", () => {
    expect(verdict(`O:${U}D:AI(A;;FA;;;${U})`)).toBe(false);
    expect(verdict(`O:${U}D:(A;;FA;;;${U})`)).toBe(false);
  });

  test("every other ACE kind, flag and owner is refused", () => {
    const cases: readonly (readonly [string, string, "dir" | "file"])[] = [
      ["an audit ACE in the DACL", `${FILE}(AU;SA;FA;;;WD)`, "file"],
      ["an alarm ACE", `${FILE}(AL;;FA;;;WD)`, "file"],
      ["a mandatory label", `${FILE}(ML;;NW;;;LW)`, "file"],
      ["a conditional deny", `${FILE}(XD;;FA;;;WD;(Member_of {SID(BA)}))`, "file"],
      ["a resource attribute", `${FILE}(RA;;;;;WD;("Project",TS,0,"x"))`, "file"],
      ["an inherited ACE", `O:${U}D:PAI(A;ID;FA;;;${U})`, "file"],
      ["read only", `O:${U}D:PAI(A;;FR;;;${U})`, "file"],
      ["rights as a hex mask", `O:${U}D:PAI(A;;0x1f01ff;;;${U})`, "file"],
      ["another SID", `O:${U}D:PAI(A;;FA;;;S-1-5-21-9-9-9-1002)`, "file"],
      ["another owner", `O:BAD:PAI(A;;FA;;;${U})`, "file"],
      ["no ACE", `O:${U}D:PAI`, "file"],
      ["no DACL at all", `O:${U}D:NO_ACCESS_CONTROL`, "file"],
      ["a file ACE on a directory", FILE, "dir"],
      ["a directory ACE on a file", DIR, "file"],
      ["a group section", `O:${U}G:${U}D:PAI(A;;FA;;;${U})`, "file"],
      ["an SACL section", `${FILE}S:AI`, "file"],
    ];
    for (const [name, sddl, kind] of cases) expect(verdict(sddl, kind), name).toBe(false);
  });

  test("garbage, unknown ACE types, unknown flags and unbalanced text do not parse", () => {
    for (const bad of [
      "",
      "not sddl",
      `O:${U}D:PAI(A;;FA;;;${U}`,
      `${FILE}junk`,
      `O:${U}D:PAI(QQ;;FA;;;${U})`,
      `O:${U}D:PXI(A;;FA;;;${U})`,
      `O:${U}D:PAI(A;;FA;;${U})`,
      `O:${U}D:PAI(XA;;FA;;;WD;(Member_of {SID(BA)})`,
      `O:${U}D:PAI(A;;FA;;;${U})(A;;FA;;;WD))`,
    ])
      expect(parseSddl(bad), bad).toBeUndefined();
  });
  test("a quoted parenthesis inside a resource-attribute ACE is skipped, so the ACE parses and is refused", () => {
    // Counting the quoted ")" would end the ACE one character early and leave text outside the ACEs.
    const dacl = parseSddl(`${DIR}(RA;;;;;WD;("a)b",TS,0x0,1))`);
    expect(dacl?.aces.map((ace) => [ace.type, ace.extra])).toEqual([
      ["A", undefined],
      ["RA", '("a)b",TS,0x0,1)'],
    ]);
    expect(dacl !== undefined && exactDaclVerdict(dacl, U, "dir")).toBe(false);
    expect(parseSddl(`${DIR}(RA;;;;;WD;("a)b,TS,0x0,1))`)).toBeUndefined();
    // A quote outside the seventh field is refused, so it cannot carry text across an ACE boundary.
    expect(parseSddl(`O:${U}D:PAI(A;;FA;"x;;;S-1-1-0)(A;OICI;FA;";;${U})`)).toBeUndefined();
    expect(parseSddl(`O:${U}D:PAI(A;OICI;FA;"";;${U})`)).toBeUndefined();
  });
  test("a quote in the GUID field that spans a fake ACE boundary is refused by the GUID check, with a valid SID field", () => {
    // Split on ';', the SID field of this ACE is FA, a valid token: only the GUID check can refuse it.
    expect(parseSddl(`O:${U}D:PAI(A;;FA;("x)(A;OICI;FA;;;S-1-1-0");;${U})`)).toBeUndefined();
  });
  test("each GUID field is checked on its own: a malformed object GUID or inherit GUID alone does not parse", () => {
    // The other GUID field is empty (valid) and the SID is a valid token, so only that one field's check can refuse it.
    expect(parseSddl(`O:${U}D:PAI(OA;OICI;FA;("x");;${U})`)).toBeUndefined();
    expect(parseSddl(`O:${U}D:PAI(OA;OICI;FA;;("x");${U})`)).toBeUndefined();
  });
  test("an ACE GUID field is empty or one canonical GUID: a paren, a quote or a malformed GUID there does not parse", () => {
    const guid = "11111111-2222-3333-4444-555555555555";
    for (const field of ['("x")', '"x"', "(x", "not-a-guid", `${guid}x`]) {
      expect(parseSddl(`O:${U}D:PAI(A;OICI;FA;${field};;${U})`), field).toBeUndefined();
      expect(parseSddl(`O:${U}D:PAI(A;OICI;FA;;${field};${U})`), field).toBeUndefined();
    }
    expect(parseSddl(`O:${U}D:PAI(A;;FA;("x;;;S-1-1-0)(A;OICI;FA;");;${U})`)).toBeUndefined();
    const withGuid = parseSddl(`O:${U}D:PAI(OA;OICI;FA;${guid};;${U})`);
    expect(withGuid?.aces[0]?.objectGuid).toBe(guid);
    expect(withGuid !== undefined && exactDaclVerdict(withGuid, U, "dir")).toBe(false);
  });
});

describe("the SDDL alias of the user", () => {
  test("the owner and ACE may carry the alias SDDL prints for the user, and only that alias", () => {
    const aliased = parseSddl("O:LAD:PAI(A;;FA;;;LA)");
    expect(aliased).toBeDefined();
    if (aliased === undefined) return;
    expect(exactDaclVerdict(aliased, U, "file", "LA")).toBe(true);
    expect(exactDaclVerdict(aliased, U, "file")).toBe(false);
    expect(exactDaclVerdict(aliased, U, "file", "BA")).toBe(false);
    const mixed = parseSddl("O:LAD:PAI(A;;FA;;;BA)");
    expect(mixed !== undefined && exactDaclVerdict(mixed, U, "file", "LA")).toBe(false);
  });
});

describe("applying the exact DACL", () => {
  test("a failed apply names the first line of the script's error", async () => {
    const failing = async () => ({
      code: 1,
      out: "",
      err: "\r\nException calling \"SetAccessControl\": Attempted to perform an unauthorized operation.\r\nAt line:18 char:3\r\n",
    });
    expect(await rejectionOf(applyExactDacl("C:\\state", U, "dir", failing))).toMatchObject({
      code: "insecure_state_dir",
      reason:
        'the exact DACL could not be applied: Exception calling "SetAccessControl": Attempted to perform an unauthorized operation.',
    });
  });

  test("a Windows PowerShell CLIXML header line is skipped when naming the error", async () => {
    const failing = async () => ({
      code: 1,
      out: "",
      err: "#< CLIXML\r\nAccess to the path is denied.\r\n",
    });
    expect(await rejectionOf(applyExactDacl("C:\\state", U, "dir", failing))).toMatchObject({
      reason: "the exact DACL could not be applied: Access to the path is denied.",
    });
  });

  test("a failed apply without error text keeps the plain refusal", async () => {
    const failing = async () => ({ code: 1, out: "" });
    expect(await rejectionOf(applyExactDacl("C:\\state", U, "file", failing))).toMatchObject({
      code: "insecure_state_dir",
      reason: "the exact DACL could not be applied",
    });
  });
});

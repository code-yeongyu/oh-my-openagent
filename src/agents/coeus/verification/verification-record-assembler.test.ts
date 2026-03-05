import { describe, expect, it } from "bun:test";
import type { BoundaryVerification } from "../schemas/verification-record-schema";
import { VerificationRecordSchema } from "../schemas/verification-record-schema";
import { assembleVerificationRecord } from "./verification-record-assembler";

describe("assembleVerificationRecord", () => {
  it("assembles a valid VerificationRecord", () => {
    //#given verifications with mixed statuses
    const verifications: BoundaryVerification[] = [
      {
        boundary: "auth: JWT signing",
        query: "auth",
        matched_entry: "auth",
        confidence: 0.9,
        tier: "tier-2-validated-reference",
        status: "verified",
      },
      {
        boundary: "quantum: routing",
        query: "quantum",
        status: "novel",
      },
    ];

    //#when assembling record
    const record = assembleVerificationRecord(
      "test-plan",
      ["auth", "quantum"],
      verifications
    );

    //#then counts are correct
    expect(record.slug).toBe("test-plan");
    expect(record.domains).toEqual(["auth", "quantum"]);
    expect(record.verified_count).toBe(1);
    expect(record.unverified_count).toBe(0);
    expect(record.novel_count).toBe(1);
    expect(record.boundaries).toHaveLength(2);
    expect(record.created).toBeTruthy();
  });

  it("counts unverified status correctly", () => {
    //#given an unverified boundary
    const verifications: BoundaryVerification[] = [
      { boundary: "db: pool", query: "db", status: "unverified" },
    ];

    //#when assembling record
    const record = assembleVerificationRecord("slug", ["db"], verifications);

    //#then unverified count is 1
    expect(record.unverified_count).toBe(1);
    expect(record.verified_count).toBe(0);
    expect(record.novel_count).toBe(0);
  });

  it("passes VerificationRecordSchema.parse", () => {
    //#given a properly assembled record
    const verifications: BoundaryVerification[] = [
      {
        boundary: "auth: tokens",
        query: "auth",
        matched_entry: "auth",
        confidence: 0.85,
        tier: "tier-3-battle-tested",
        status: "verified",
      },
      { boundary: "cache: redis", query: "cache", status: "novel" },
      { boundary: "db: pool", query: "db", status: "unverified" },
    ];
    const record = assembleVerificationRecord(
      "plan-abc",
      ["auth", "cache", "db"],
      verifications
    );

    //#when parsing with Zod schema
    const parsed = VerificationRecordSchema.parse(record);

    //#then it succeeds without throwing
    expect(parsed.slug).toBe("plan-abc");
    expect(parsed.verified_count).toBe(1);
    expect(parsed.unverified_count).toBe(1);
    expect(parsed.novel_count).toBe(1);
  });

  it("sets created as ISO string", () => {
    //#given empty verifications
    const record = assembleVerificationRecord("s", ["a"], []);

    //#when checking created
    //#then it's a valid ISO date
    expect(() => new Date(record.created)).not.toThrow();
    expect(record.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

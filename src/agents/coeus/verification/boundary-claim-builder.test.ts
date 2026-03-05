import { describe, expect, it } from "bun:test";
import { buildBoundaryClaims } from "./boundary-claim-builder";

describe("buildBoundaryClaims", () => {
  it("returns one claim per domain", () => {
    //#given two domains
    const domains = ["auth", "backend"];
    const constraints = "";

    //#when building boundary claims
    const claims = buildBoundaryClaims(domains, constraints);

    //#then returns 2 claims, one per domain
    expect(claims).toHaveLength(2);
    expect(claims[0].domain).toBe("auth");
    expect(claims[1].domain).toBe("backend");
  });

  it("sets query_term to domain name", () => {
    //#given a single domain
    const domains = ["caching"];

    //#when building boundary claims
    const claims = buildBoundaryClaims(domains, "");

    //#then query_term matches domain
    expect(claims[0].query_term).toBe("caching");
  });

  it("builds boundary string from domain", () => {
    //#given domains
    const domains = ["auth", "backend"];

    //#when building boundary claims
    const claims = buildBoundaryClaims(domains, "");

    //#then each claim has a non-empty boundary
    for (const claim of claims) {
      expect(claim.boundary.length).toBeGreaterThan(0);
      expect(claim.boundary).toContain(claim.domain);
    }
  });

  it("incorporates constraints into boundary when provided", () => {
    //#given domains with constraints
    const domains = ["auth"];
    const constraints = "JWT signing required";

    //#when building boundary claims
    const claims = buildBoundaryClaims(domains, constraints);

    //#then boundary references the constraint
    expect(claims[0].boundary).toContain("JWT signing required");
  });

  it("returns empty array for empty domains", () => {
    //#given no domains
    //#when building boundary claims
    const claims = buildBoundaryClaims([], "");

    //#then returns empty
    expect(claims).toHaveLength(0);
  });
});

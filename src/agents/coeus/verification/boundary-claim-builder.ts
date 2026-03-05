export interface BoundaryClaim {
  boundary: string;
  domain: string;
  query_term: string;
}

export function buildBoundaryClaims(
  domains: string[],
  constraints: string
): BoundaryClaim[] {
  return domains.map((domain) => ({
    boundary: constraints
      ? `${domain}: ${constraints}`
      : `${domain}: boundary claim`,
    domain,
    query_term: domain,
  }));
}

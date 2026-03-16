import type {
  BoundaryVerification,
  VerificationRecord,
} from "../schemas/verification-record-schema";

export function assembleVerificationRecord(
  slug: string,
  domains: string[],
  verifications: BoundaryVerification[]
): VerificationRecord {
  let verified = 0;
  let unverified = 0;
  let novel = 0;

  for (const v of verifications) {
    if (v.status === "verified") verified++;
    else if (v.status === "unverified") unverified++;
    else if (v.status === "novel") novel++;
  }

  return {
    slug,
    created: new Date().toISOString(),
    domains,
    boundaries: verifications,
    verified_count: verified,
    unverified_count: unverified,
    novel_count: novel,
  };
}

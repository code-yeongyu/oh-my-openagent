export { mergeSortEntry } from "./merge-sort";
export { rateLimitingEntry } from "./rate-limiting";
export { authenticationEntry } from "./authentication";
export { cachingEntry } from "./caching";

import { mergeSortEntry } from "./merge-sort";
import { rateLimitingEntry } from "./rate-limiting";
import { authenticationEntry } from "./authentication";
import { cachingEntry } from "./caching";
import type { TaxonomyEntry } from "../schema";

export const SEED_ENTRIES: TaxonomyEntry[] = [
  mergeSortEntry,
  rateLimitingEntry,
  authenticationEntry,
  cachingEntry,
];

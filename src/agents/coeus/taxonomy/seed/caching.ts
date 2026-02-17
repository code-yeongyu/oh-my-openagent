import type { TaxonomyEntry } from "../schema";

export const cachingEntry: TaxonomyEntry = {
  category: "caching",
  solutions: [
    {
      name: "LRUCache",
      description:
        "Least Recently Used cache eviction policy. Discards least recently accessed items when capacity reached. Efficient for temporal locality workloads.",
      sources: [
        {
          ref: "The Art of Computer Programming, Vol. 1 (Knuth)",
          claim: "LRU is optimal for certain access patterns with temporal locality",
          tier: "tier-1-ground-truth",
          confidence: 0.95,
          type: "textbook",
          isbn: "978-0201896831",
        },
      ],
      constraints: {
        time_complexity_get: "O(1)",
        time_complexity_put: "O(1)",
        space_complexity: "O(capacity)",
      },
    },
    {
      name: "WriteThrough",
      description:
        "Cache write strategy where writes go to cache and backing store simultaneously. Ensures consistency but higher write latency than write-back.",
      sources: [
        {
          ref: "Computer Architecture: A Quantitative Approach (Hennessy & Patterson)",
          claim: "Write-through maintains cache coherence by writing to both cache and memory",
          tier: "tier-1-ground-truth",
          confidence: 0.98,
          type: "textbook",
          isbn: "978-0128119051",
        },
      ],
      constraints: {
        consistency: "strong",
        write_latency: "higher than write-back",
      },
    },
  ],
  related: ["cdn", "memoization", "redis", "memcached"],
  implementation_notes: [
    "LRU: use doubly-linked list + hash map for O(1) operations",
    "Write-through: simpler than write-back, no dirty bit tracking",
    "Consider TTL (time-to-live) for cache invalidation",
    "Monitor cache hit rate to tune capacity",
  ],
};

import type { TaxonomyEntry } from "../schema";

export const rateLimitingEntry: TaxonomyEntry = {
  category: "rate-limiting",
  solutions: [
    {
      name: "TokenBucket",
      description:
        "Rate limiting algorithm using bucket of tokens. Tokens added at fixed rate, requests consume tokens. Allows bursts up to bucket capacity.",
      sources: [
        {
          ref: "RFC 2698 - A Two Rate Three Color Marker",
          claim: "Token bucket algorithm for traffic metering",
          tier: "tier-2-validated-reference",
          confidence: 0.95,
          type: "spec",
          url: "https://datatracker.ietf.org/doc/html/rfc2698",
        },
      ],
      constraints: {
        burst_capacity: "configurable",
        refill_rate: "tokens per second",
      },
    },
    {
      name: "SlidingWindow",
      description:
        "Rate limiting using sliding time window. Tracks requests in current window, rejects if limit exceeded. More accurate than fixed window.",
      sources: [
        {
          ref: "RFC 6585 - Additional HTTP Status Codes (429 Too Many Requests)",
          claim: "HTTP 429 status code for rate limiting",
          tier: "tier-2-validated-reference",
          confidence: 0.9,
          type: "spec",
          url: "https://datatracker.ietf.org/doc/html/rfc6585",
        },
      ],
      constraints: {
        window_size: "time duration",
        request_limit: "max requests per window",
      },
    },
  ],
  related: ["circuit-breaker", "backpressure", "throttling"],
  implementation_notes: [
    "Token bucket allows controlled bursts",
    "Sliding window prevents boundary gaming",
    "Consider distributed rate limiting for multi-instance systems",
  ],
};

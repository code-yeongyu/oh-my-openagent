export const REVIEW_KEYS = ["review1", "review2", "review3"] as const
export type ReviewKey = (typeof REVIEW_KEYS)[number]

import type { TaxonomyEntry } from "../schema";

export const mergeSortEntry: TaxonomyEntry = {
  category: "sorting-algorithms",
  solutions: [
    {
      name: "MergeSort",
      description:
        "Divide-and-conquer sorting algorithm with O(n log n) worst-case time complexity. Recursively divides array into halves, sorts each half, then merges sorted halves.",
      sources: [
        {
          ref: "CLRS - Introduction to Algorithms (4th Edition)",
          claim: "MergeSort has Θ(n log n) worst-case running time",
          tier: "tier-1-ground-truth",
          confidence: 1.0,
          type: "textbook",
          isbn: "978-0262046305",
        },
      ],
      constraints: {
        time_complexity: "O(n log n)",
        space_complexity: "O(n)",
        stable: true,
      },
    },
  ],
  complexity: "O(n log n) time, O(n) space",
  related: ["quicksort", "heapsort", "timsort"],
  implementation_notes: [
    "Requires auxiliary array for merging",
    "Stable sort - preserves relative order of equal elements",
    "Parallelizable due to divide-and-conquer structure",
  ],
};

export function shout(s: string): string { return s.toUpperCase() }
export function reverse(s: string): string { return s.split("").reverse().join("") }
export function countWords(s: string): number { return s.split(" ").filter((w) => w !== "").length }

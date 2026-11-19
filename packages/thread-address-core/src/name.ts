/**
 * The one name comparison for threads and devices: NFKC, trim, lowercase, whitespace collapsed, so a composed and a
 * decomposed spelling of the same name are one name.
 */
export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ")
}

export type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>

export function getFirstSearchValue(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key]
  if (typeof value === "string") {
    return value
  }
  return value?.[0]
}

export function getCustomerEmail(searchParams: SearchParams): string {
  return getFirstSearchValue(searchParams, "email") ?? ""
}

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

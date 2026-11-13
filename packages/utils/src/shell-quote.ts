/**
 * Quote one argument for a POSIX shell so it pastes back as exactly that argument: wrap it in
 * single quotes and turn every embedded single quote into '\'' (close, escaped quote, reopen).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export interface RetryOptions {
  request?: (url: string | URL, init: RequestInit) => Promise<Response>
  sleep?: (milliseconds: number) => Promise<unknown>
  log?: (line: string) => void
}
export function requestWithRetry(label: string, url: string | URL, init: RequestInit, options?: RetryOptions): Promise<Response>
export function verifyPublisher(pkg: string, token: string, options?: RetryOptions): Promise<void>
export function main(packages: string[], env?: NodeJS.ProcessEnv): Promise<void>

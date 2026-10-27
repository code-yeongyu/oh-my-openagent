import { context, defaultTextMapSetter } from "@opentelemetry/api"
import { W3CTraceContextPropagator } from "@opentelemetry/core"

import type { OtlpFetch } from "./otlp-http"

/** Our own hosts: the collector and the omo-service API. Model-provider hosts are never listed. */
export const OMO_TRACE_HOSTS: readonly string[] = ["t.omo.dev", "api.omo.dev"]

const w3c = new W3CTraceContextPropagator()

export function urlHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Adds the active span's `traceparent` to requests whose host is exactly one of `hosts`; every other
 * request, and every request made outside a span, passes through untouched.
 */
export function createTraceparentFetch(fetch: OtlpFetch, hosts: Iterable<string>): OtlpFetch {
  const allowed = new Set([...hosts].map((host) => host.toLowerCase()))
  return (url, init) => {
    const host = urlHost(url)
    if (host === undefined || !allowed.has(host)) return fetch(url, init)
    const carrier: Record<string, string> = {}
    w3c.inject(context.active(), carrier, defaultTextMapSetter)
    const traceparent = carrier["traceparent"]
    if (traceparent === undefined) return fetch(url, init)
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    return fetch(url, { ...init, headers: { ...headers, traceparent } })
  }
}

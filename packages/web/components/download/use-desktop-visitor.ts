"use client"

import { useEffect, useState } from "react"

import {
  detectDesktopPlatform,
  type DesktopClient,
  type DesktopVisitor,
} from "@/lib/desktop-download"

interface UserAgentData {
  readonly platform?: unknown
  readonly mobile?: unknown
  readonly getHighEntropyValues?: unknown
}

function readUserAgentData(nav: Navigator): UserAgentData {
  const data: unknown = Reflect.get(nav, "userAgentData")
  return typeof data === "object" && data !== null ? data : {}
}

function readClient(nav: Navigator, architecture?: string): DesktopClient {
  const data = readUserAgentData(nav)
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    ...(typeof data.platform === "string" ? { uaPlatform: data.platform } : {}),
    ...(typeof data.mobile === "boolean" ? { mobile: data.mobile } : {}),
    ...(architecture === undefined ? {} : { architecture }),
  }
}

async function readArchitecture(nav: Navigator): Promise<string | undefined> {
  const { getHighEntropyValues } = readUserAgentData(nav)
  if (typeof getHighEntropyValues !== "function") return undefined
  const values: unknown = await Reflect.apply(
    getHighEntropyValues,
    Reflect.get(nav, "userAgentData"),
    [["architecture"]],
  )
  const architecture =
    typeof values === "object" && values !== null ? Reflect.get(values, "architecture") : null
  return typeof architecture === "string" && architecture !== "" ? architecture : undefined
}

/**
 * The visitor's OS and CPU, or `null` until the browser has been asked. The OS comes straight
 * from `navigator`; the CPU needs a second, asynchronous question that Chromium answers and
 * Safari and Firefox do not, in which case the first answer stands.
 */
export function useDesktopVisitor(): DesktopVisitor | null {
  const [visitor, setVisitor] = useState<DesktopVisitor | null>(null)

  useEffect(() => {
    let current = true
    async function detect(): Promise<void> {
      setVisitor(detectDesktopPlatform(readClient(navigator)))
      try {
        const architecture = await readArchitecture(navigator)
        if (current && architecture !== undefined) {
          setVisitor(detectDesktopPlatform(readClient(navigator, architecture)))
        }
      } catch {
        // The browser refused the CPU question; the OS-only answer already on screen stands.
      }
    }
    void detect()
    return () => {
      current = false
    }
  }, [])

  return visitor
}

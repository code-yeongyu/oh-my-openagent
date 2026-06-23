import type { PoolEntry } from "./pool-schema"

export const DESKTOP_VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
]

export const MOBILE_VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]

export const TABLET_VIEWPORTS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1024, height: 1366 },
  { width: 820, height: 1180 },
  { width: 768, height: 1024 },
]

export function pickViewportFor(type: PoolEntry["type"], seed = 0): { width: number; height: number } {
  const list =
    type === "mobile" ? MOBILE_VIEWPORTS :
    type === "tablet" ? TABLET_VIEWPORTS :
    DESKTOP_VIEWPORTS
  const idx = ((seed % list.length) + list.length) % list.length
  return list[idx]!
}

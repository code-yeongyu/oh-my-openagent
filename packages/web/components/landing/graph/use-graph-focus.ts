"use client"

import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
export function setFocused(id: string | null) {
  snapshot = { focusedId: id, setFocused }
  listeners.forEach((listener) => listener())
}
const serverSnapshot: {
  readonly focusedId: string | null
  readonly setFocused: typeof setFocused
} = { focusedId: null, setFocused }
let snapshot = serverSnapshot
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useGraphFocus() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  )
}

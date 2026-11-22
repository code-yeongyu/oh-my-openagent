"use client"

import { useEffect } from "react"

/** One observer for the whole page: each `.rise` rises in once as it enters the screen (DESIGN 4, --dur-enter). */
export function RevealObserver(): null {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add("js")
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add("in")
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    )
    for (const item of document.querySelectorAll(".rise")) observer.observe(item)
    return () => observer.disconnect()
  }, [])
  return null
}

"use client"

import { useRef, useEffect, useState } from "react"

interface TerminalTypewriterProps {
  text: string
}

export function TerminalTypewriter({ text }: TerminalTypewriterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isInView, setIsInView] = useState(false)
  const [displayed, setDisplayed] = useState("")

  useEffect(() => {
    const element = ref.current
    if (!element || isInView) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setIsInView(true)
        observer.disconnect()
      },
      { threshold: 0.1 },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [isInView])

  useEffect(() => {
    if (!isInView) return
    let i = 0
    const interval = setInterval(() => {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i))
        i++
      } else {
        clearInterval(interval)
      }
    }, 40)
    return () => clearInterval(interval)
  }, [isInView, text])

  return (
    <span ref={ref} className="text-zinc-300">
      {displayed}
      {displayed.length < text.length && <span className="animate-pulse">_</span>}
    </span>
  )
}

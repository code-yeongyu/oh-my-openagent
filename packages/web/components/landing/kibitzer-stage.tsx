"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { ArrowDown, RotateCcw } from "lucide-react"
import { useTranslations } from "next-intl"

export function KibitzerStage() {
  const t = useTranslations("landing.kibitzer")
  const ref = useRef<HTMLDivElement>(null)
  const [running, setRunning] = useState(false)
  const [turn, setTurn] = useState(14)

  useEffect(() => {
    const stage = ref.current
    if (!stage) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setRunning(entry.isIntersecting)
      },
      { threshold: 0.15 },
    )
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      role="img"
      aria-label={t("scene")}
      data-testid="kibitzer-stage"
      data-running={running}
      className="kib-stage"
    >
      <div data-kib-column="side" aria-hidden="true" className="kib-side">
        <p className="eyebrow text-text-lo">{t("sidecar")}</p>
        <p className="text-text-mid mt-2 text-sm">{t("cheapLoop")}</p>
        <ol className="kib-watch mt-4">
          {(["watch", "read", "judge"] as const).map((step, index) => (
            <li key={step} className="kib-watch-step" style={{ "--i": index } as CSSProperties}>
              <span className="kib-dot" />
              {t(step)}
            </li>
          ))}
        </ol>
        <div className="kib-memory mt-4 border-l pl-3">
          <p className="text-text-lo font-mono text-xs">{t("memory")}</p>
          <p className="text-text-mid mt-2 text-sm">{t("memoryNote")}</p>
        </div>
        <p className="text-text-lo mt-4 flex items-center gap-2 font-mono text-xs">
          <RotateCcw className="size-3" /> {t("watchAgain")}
        </p>
      </div>
      <div data-kib-column="main" aria-hidden="true" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow text-text-lo">{t("main")}</p>
          <span className="text-accent font-mono text-xs tabular-nums">{t("turn", { turn })}</span>
        </div>
        <p className="text-text-mid mt-2 text-sm">{t("expensiveLoop")}</p>
        <ol className="kib-main-track mt-4">
          <li
            className="kib-main-step"
            style={{ "--i": 0 } as CSSProperties}
            onAnimationIteration={(event) => {
              if (event.target === event.currentTarget) setTurn((value) => value + 1)
            }}
          >
            <span className="kib-dot" />
            {t("plan")}
          </li>
          <li className="kib-main-step" style={{ "--i": 1 } as CSSProperties}>
            <span className="kib-dot" />
            {t("act")}
          </li>
          <li className="kib-insertion">
            <div data-kib-nudge className="kib-nudge">
              <span className="flex items-center gap-2 font-mono text-xs">
                <ArrowDown className="size-4" />
                {t("nudge")}
              </span>
              <p className="mt-2 text-sm">{t("reason")}</p>
            </div>
          </li>
          <li className="kib-main-step" style={{ "--i": 2 } as CSSProperties}>
            <span className="kib-dot" />
            <span className="kib-decision">
              <span className="kib-before">{t("skip")}</span>
              <span className="kib-after">{t("testFirst")}</span>
            </span>
          </li>
          <li className="kib-main-step" style={{ "--i": 3 } as CSSProperties}>
            <span className="kib-dot" />
            {t("ship")}
          </li>
        </ol>
        <p className="kib-return text-text-lo flex items-center gap-2 font-mono text-xs">
          <RotateCcw className="size-4" />
          {t("nextTurn")}
        </p>
      </div>
    </div>
  )
}

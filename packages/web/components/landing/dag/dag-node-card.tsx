"use client"

import type { JSX } from "react"

import { cn } from "@/lib/utils"

import { nodeEntryDelay } from "./motion"
import { nodeElapsedSeconds } from "./scenario"
import { dagStatus } from "./status"
import type { DagNode } from "./types"

export interface DagNodeCardProps {
  readonly node: DagNode
  readonly clockMs: number
  readonly position: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
  readonly enterIndex?: number | undefined
  readonly popping: boolean
  readonly shaking: boolean
  readonly motionOK: boolean
  readonly dimmed: boolean
  readonly connected: boolean
  readonly onClearOneShot: (nodeId: string) => void
  readonly onFocusNode: (nodeId: string | null) => void
  readonly onSelect: (nodeId: string) => void
}

/**
 * Port of the desktop app's WorkflowGraphNodeCard onto the ledger tokens: opaque `--ink-1`
 * surface, 0 radius, 6px state dot, state text in the state's ink, then `category · model`
 * with the model raised to `--text-hi` mono — the model IS the story on this surface.
 */
export function DagNodeCard({
  node,
  clockMs,
  position,
  enterIndex,
  popping,
  shaking,
  motionOK,
  dimmed,
  connected,
  onClearOneShot,
  onFocusNode,
  onSelect,
}: DagNodeCardProps): JSX.Element {
  const status = dagStatus(node.state)
  const elapsed = nodeElapsedSeconds(node, clockMs)
  // A node off the focused dependency path recedes by colour, never by opacity: its text drops
  // to --text-lo (5.5:1 or better on every ink) so it still reads, and the state dot fades.
  const ink = (presentClass: string): string => (dimmed ? "text-text-lo" : presentClass)
  return (
    <button
      type="button"
      data-dag-node={node.id}
      data-node-state={node.state}
      data-dimmed={dimmed ? "true" : undefined}
      aria-label={`${node.label}: ${node.state}, ${node.category} on ${node.model}`}
      className={cn(
        "border-line bg-ink-1 ease-standard absolute flex cursor-pointer flex-col gap-0.5 overflow-hidden border px-2.5 py-2 text-left transition-[border-color,background-color] duration-[var(--dur-micro)]",
        "focus-ring-inset",
        status.cardToneClass,
        connected && status.cardConnectedClass,
        status.cardHoverClass,
        enterIndex !== undefined && "dag-node-enter",
        motionOK && popping && "dag-node-pop",
        motionOK && shaking && "dag-node-shake",
        dimmed && "border-line",
      )}
      style={{
        ...position,
        ...(enterIndex === undefined
          ? {}
          : { animationDelay: `${nodeEntryDelay(enterIndex).delayMs}ms` }),
      }}
      onAnimationEnd={() => onClearOneShot(node.id)}
      onPointerEnter={() => onFocusNode(node.id)}
      onPointerLeave={() => onFocusNode(null)}
      onFocus={() => onFocusNode(node.id)}
      onBlur={() => onFocusNode(null)}
      onClick={() => onSelect(node.id)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.dotClass,
            status.dotPulses && motionOK && "pulse-dot",
            dimmed && "opacity-40",
          )}
        />
        <span className={cn(ink("text-text-hi"), "truncate text-sm font-medium")}>
          {node.label}
        </span>
      </span>
      <span className="text-text-lo truncate text-xs">
        <span className={ink(status.textClass)}>{node.state}</span>
        {elapsed === undefined ? "" : ` · ${elapsed}s`}
      </span>
      <span className="truncate text-xs">
        <span className="text-text-lo">{node.category}</span>
        <span aria-hidden="true" className="text-text-faint">
          {" · "}
        </span>
        <span className={cn(ink("text-text-hi"), "font-mono")}>{node.model}</span>
      </span>
      {node.activity === undefined ? null : (
        <span className="text-text-lo truncate text-xs">{node.activity}</span>
      )}
    </button>
  )
}

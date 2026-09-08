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
  return (
    <button
      type="button"
      data-dag-node={node.id}
      data-node-state={node.state}
      aria-label={`${node.label}: ${node.state}, ${node.category} on ${node.model}`}
      className={cn(
        "border-line bg-ink-1 ease-standard absolute flex cursor-pointer flex-col gap-0.5 overflow-hidden border px-2.5 py-2 text-left transition-[border-color,background-color] duration-[var(--dur-micro)]",
        "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
        status.cardToneClass,
        connected && status.cardConnectedClass,
        status.cardHoverClass,
        enterIndex !== undefined && "dag-node-enter",
        motionOK && popping && "dag-node-pop",
        motionOK && shaking && "dag-node-shake",
        // Content-level, never element-level: the card sits on the edge canvas and an
        // element-level opacity would let the strokes bleed through an opaque surface.
        dimmed && "[&>*]:opacity-20",
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
          )}
        />
        <span className="text-text-hi truncate text-sm font-medium">{node.label}</span>
      </span>
      <span className="text-text-lo truncate text-xs">
        <span className={status.textClass}>{node.state}</span>
        {elapsed === undefined ? "" : ` · ${elapsed}s`}
      </span>
      <span className="truncate text-xs">
        <span className="text-text-lo">{node.category}</span>
        <span className="text-text-faint"> · </span>
        <span className="text-text-hi font-mono">{node.model}</span>
      </span>
      {node.activity === undefined ? null : (
        <span className="text-text-lo truncate text-xs">{node.activity}</span>
      )}
    </button>
  )
}

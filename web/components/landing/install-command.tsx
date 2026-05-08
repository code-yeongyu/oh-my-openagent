"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

export function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.warn("Failed to copy install command", err)
    }
  }

  return (
    <div className="relative rounded-lg border border-zinc-800 bg-black/50 p-4 font-mono text-sm text-zinc-300 shadow-2xl shadow-cyan-500/10 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-cyan-500">$</span>
          <span>{command}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-zinc-400 hover:text-white"
          onClick={copyCommand}
          aria-label="Copy install command"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

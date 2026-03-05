import { execSync } from "child_process"
import os from "os"

export type MemoryStatus = {
  availableGB: number
  usedPercent: number
  swapUsedPercent: number
  recommendation: "parallelize_5" | "parallelize_2" | "serialize" | "wait"
}

type VmStatMemory = {
  pageSizeBytes: number
  freePages: number
  inactivePages: number
  activePages: number
  wiredPages: number
  speculativePages: number
}

const BYTES_PER_GB = 1024 ** 3

function getRecommendation(availableGB: number): MemoryStatus["recommendation"] {
  if (availableGB < 1) {
    return "wait"
  }

  if (availableGB < 2) {
    return "serialize"
  }

  if (availableGB < 4) {
    return "parallelize_2"
  }

  return "parallelize_5"
}

function parseVmStat(output: string): VmStatMemory {
  const pageSizeMatch = output.match(/page size of\s+(\d+)\s+bytes/i)
  if (!pageSizeMatch) {
    throw new Error("Unable to parse page size from vm_stat output")
  }

  const pageSizeBytes = Number.parseInt(pageSizeMatch[1], 10)
  const pageCounts = new Map<string, number>()

  for (const line of output.split("\n")) {
    const match = line.match(/^Pages\s+([^:]+):\s+(\d+)\./)
    if (!match) {
      continue
    }

    pageCounts.set(match[1].trim().toLowerCase(), Number.parseInt(match[2], 10))
  }

  return {
    pageSizeBytes,
    freePages: pageCounts.get("free") ?? 0,
    inactivePages: pageCounts.get("inactive") ?? 0,
    activePages: pageCounts.get("active") ?? 0,
    wiredPages: pageCounts.get("wired down") ?? 0,
    speculativePages: pageCounts.get("speculative") ?? 0,
  }
}

function parseSizeToBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMGTP])$/i)
  if (!match) {
    throw new Error(`Unable to parse size: ${value}`)
  }

  const amount = Number.parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multiplierByUnit: Record<string, number> = {
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  }

  return amount * multiplierByUnit[unit]
}

function parseSwapPercent(output: string): number {
  const totalMatch = output.match(/total\s*=\s*([0-9.]+[KMGTP])/i)
  const usedMatch = output.match(/used\s*=\s*([0-9.]+[KMGTP])/i)
  if (!totalMatch || !usedMatch) {
    throw new Error("Unable to parse swap usage from sysctl output")
  }

  const totalBytes = parseSizeToBytes(totalMatch[1])
  const usedBytes = parseSizeToBytes(usedMatch[1])
  if (totalBytes <= 0) {
    return 0
  }

  return (usedBytes / totalBytes) * 100
}

function getFallbackStatus(): MemoryStatus {
  const totalBytes = os.totalmem()
  const availableBytes = os.freemem()
  const availableGB = availableBytes / BYTES_PER_GB
  const usedPercent = ((totalBytes - availableBytes) / totalBytes) * 100

  return {
    availableGB,
    usedPercent,
    swapUsedPercent: 0,
    recommendation: getRecommendation(availableGB),
  }
}

export function checkMacOSMemory(): MemoryStatus {
  try {
    const vmStatOutput = execSync("vm_stat", { encoding: "utf8" })
    const swapOutput = execSync("sysctl vm.swapusage", { encoding: "utf8" })

    const vm = parseVmStat(vmStatOutput)
    const availableBytes = (vm.freePages + vm.inactivePages) * vm.pageSizeBytes
    const totalBytes = os.totalmem()
    const availableGB = availableBytes / BYTES_PER_GB
    const usedPercent = ((totalBytes - availableBytes) / totalBytes) * 100
    const swapUsedPercent = parseSwapPercent(swapOutput)

    return {
      availableGB,
      usedPercent,
      swapUsedPercent,
      recommendation: getRecommendation(availableGB),
    }
  } catch (error) {
    return getFallbackStatus()
  }
}

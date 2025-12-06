import type { PluginInput } from "@opencode-ai/plugin"

export function createPulseMonitorHook(ctx: PluginInput) {
  const STANDARD_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const THINKING_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  const CHECK_INTERVAL = 5 * 1000 // 5 seconds
  
  let lastHeartbeat = Date.now()
  let isMonitoring = false
  let currentSessionID: string | null = null
  let monitorTimer: ReturnType<typeof setInterval> | null = null
  let isThinking = false
  
  const startMonitoring = (sessionID: string) => {
    if (currentSessionID !== sessionID) {
      currentSessionID = sessionID
      // Reset thinking state when switching sessions or starting new
      isThinking = false
    }
    
    lastHeartbeat = Date.now()
    
    if (!isMonitoring) {
      isMonitoring = true
      if (monitorTimer) clearInterval(monitorTimer)
      
      monitorTimer = setInterval(async () => {
        if (!isMonitoring || !currentSessionID) return
        
        const timeSinceLastHeartbeat = Date.now() - lastHeartbeat
        const currentTimeout = isThinking ? THINKING_TIMEOUT : STANDARD_TIMEOUT
        
        if (timeSinceLastHeartbeat > currentTimeout) {
          await recoverStalledSession(currentSessionID, timeSinceLastHeartbeat, isThinking)
        }
      }, CHECK_INTERVAL)
    }
  }
  
  const stopMonitoring = () => {
    isMonitoring = false
    if (monitorTimer) {
      clearInterval(monitorTimer)
      monitorTimer = null
    }
  }
  
  const updateHeartbeat = (isThinkingUpdate?: boolean) => {
    if (isMonitoring) {
      lastHeartbeat = Date.now()
      if (isThinkingUpdate !== undefined) {
        isThinking = isThinkingUpdate
      }
    }
  }
  
  const recoverStalledSession = async (sessionID: string, stalledDuration: number, wasThinking: boolean) => {
    stopMonitoring()
    
    try {
      const durationSec = Math.round(stalledDuration/1000)
      const typeStr = wasThinking ? "Thinking" : "Standard"
      
      // 1. Notify User
      await ctx.client.tui.showToast({
        body: {
            title: "Pulse Monitor: Cardiac Arrest",
            message: `Session stalled (${typeStr}) for ${durationSec}s. Defibrillating...`,
            variant: "error",
            duration: 5000
        }
      }).catch(() => {})
      
      // 2. Abort current generation (Defibrillation shock)
      await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})
      
      // 3. Wait a bit for state to settle
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // 4. Prompt "continue" to kickstart (CPR)
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: "The connection was unstable and stalled. Please continue from where you left off." }] },
        query: { directory: ctx.directory }
      })
      
      // Resume monitoring
      startMonitoring(sessionID)
      
    } catch (err) {
      console.error("[PulseMonitor] Recovery failed:", err)
      // If recovery fails, we stop monitoring to avoid loops
      stopMonitoring()
    }
  }

  return {
    event: async (input: { event: any }) => {
      const { event } = input
      const props = event.properties as Record<string, any> | undefined
      
      // Monitor both session updates and part updates to capture token flow
      if (event.type === "session.updated" || event.type === "message.part.updated") {
        // Try to get sessionID from various common locations
        const sessionID = props?.info?.id || props?.sessionID
        
        if (sessionID) {
            if (!isMonitoring) startMonitoring(sessionID)
            
            // Check for thinking indicators in the payload
            let thinkingUpdate: boolean | undefined = undefined
            
            if (event.type === "message.part.updated") {
                const part = props?.part
                if (part) {
                    const THINKING_TYPES = ["thinking", "redacted_thinking", "reasoning"]
                    if (THINKING_TYPES.includes(part.type)) {
                        thinkingUpdate = true
                    } else if (part.type === "text" || part.type === "tool_use") {
                        thinkingUpdate = false
                    }
                }
            }
            
            updateHeartbeat(thinkingUpdate)
        }
      } else if (event.type === "session.idle" || event.type === "session.error" || event.type === "session.stopped") {
        stopMonitoring()
      }
    },
    "tool.execute.before": async () => {
        // Pause monitoring while tool runs locally (tools can take time)
        stopMonitoring()
    },
    "tool.execute.after": async (input: { sessionID: string }) => {
        // Resume monitoring after tool finishes
        if (input.sessionID) {
            startMonitoring(input.sessionID)
        }
    }
  }
}

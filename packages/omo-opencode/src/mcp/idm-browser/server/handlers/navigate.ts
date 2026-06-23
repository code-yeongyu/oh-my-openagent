import { mkdirSync } from "node:fs"
import { 
  enhancedRecordingPaths, 
  slugifyLabel, 
  validateLabelOrThrow 
} from "../../recording/recording-directory"
import { writeRecordingMetadata } from "../../../../automation/hermes/recording-metadata"
import type { BrowserPool } from "../../pool"

export type NavigateParams = {
  url: string
  waitUntil?: "load" | "domcontentloaded" | "networkidle"
  sessionId?: string
  accountId?: string
  label?: string
  engine?: string
}

export async function handleNavigate(pool: BrowserPool, params: NavigateParams) {
  if (params.engine) {
    pool.switchEngine(params.engine)
  }

  let recordingDir: string | undefined
  let recordingName: string | undefined

  if (params.label && !params.sessionId) {
    recordingName = slugifyLabel(params.label)
    const paths = enhancedRecordingPaths(recordingName)
    recordingDir = paths.dir
    
    mkdirSync(recordingDir, { recursive: true })
    
    // Write stub metadata
    await writeRecordingMetadata(recordingName, {
      name: recordingName,
      description: `Recording for ${params.url}`,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      parameters: [],
      steps: 0,
      vision_checkpoint_count: 0
    })
  }

  const session = await pool.acquire(params.sessionId, recordingDir)
  
  // Force a recording entry for the navigate itself if we have a recordingDir
  if (recordingDir) {
    const { recordAction } = await import("../../recording/session-recorder")
    recordAction({
      ts: Date.now(),
      tool: "browser_navigate",
      params: { url: params.url, waitUntil: params.waitUntil, label: params.label },
      sessionId: session.id,
      durationMs: 0,
      success: true,
      recordingDir
    })
  }
  await session.page.goto(params.url, {
    waitUntil: params.waitUntil ?? "domcontentloaded",
  })

  const title = await session.page.title()
  const currentUrl = session.page.url()

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ 
        sessionId: session.id, 
        url: currentUrl, 
        title,
        recordingName 
      }, null, 2),
    }],
  }
}

import { extname } from "node:path"

export function inferMimeTypeFromBase64(base64Data: string): string {
  if (base64Data.startsWith("data:")) {
    const match = base64Data.match(/^data:([^;]+);/)
    if (match) return match[1]
  }

  try {
    const cleanData = base64Data.replace(/^data:[^;]+;base64,/, "")
    const header = atob(cleanData.slice(0, 16))

    if (header.startsWith("\x89PNG")) return "image/png"
    if (header.startsWith("\xFF\xD8\xFF")) return "image/jpeg"
    if (header.startsWith("GIF8")) return "image/gif"
    if (header.startsWith("RIFF") && header.includes("WEBP")) return "image/webp"
    if (header.startsWith("%PDF")) return "application/pdf"
  } catch {
    // invalid base64 - fall through
  }

  return "image/png"
}

export function inferMimeTypeFromFilePath(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".mov": "video/mov",
    ".avi": "video/avi",
    ".flv": "video/x-flv",
    ".webm": "video/webm",
    ".wmv": "video/wmv",
    ".3gpp": "video/3gpp",
    ".3gp": "video/3gpp",
    ".wav": "audio/wav",
    ".mp3": "audio/mp3",
    ".aiff": "audio/aiff",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".md": "text/md",
    ".html": "text/html",
    ".json": "application/json",
    ".xml": "application/xml",
    ".js": "text/javascript",
    ".py": "text/x-python",
  }
  return mimeTypes[ext] || "application/octet-stream"
}

export function extractBase64Data(imageData: string): string {
  if (imageData.startsWith("data:")) {
    const commaIndex = imageData.indexOf(",")
    if (commaIndex !== -1) {
      return imageData.slice(commaIndex + 1)
    }
  }
  return imageData
}

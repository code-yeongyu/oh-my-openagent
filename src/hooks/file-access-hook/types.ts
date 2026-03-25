export interface FileAccessConfig {
  allowedPaths?: string[]
  deniedPaths?: string[]
  allowedExtensions?: string[]
  deniedExtensions?: string[]
  allowWrite?: boolean
  allowEdit?: boolean
}

export interface FileAccessResult {
  allowed: boolean
  reason?: string
}

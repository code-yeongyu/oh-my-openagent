export interface ResumeReport {
  resumed: number
  marked_failed: number
  marked_orphaned: number
  cleaned: number
  errors: Error[]
}

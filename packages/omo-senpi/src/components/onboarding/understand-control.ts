/** Skip and stop for one understanding run; the RPC shell holds it, the runtime reads it between and during steps. */
export class OnboardingUnderstandingControl {
  private stopRequested = false
  private readonly skippedProjects = new Set<string>()
  private running: { readonly projects: ReadonlySet<string>; readonly cancel: () => void } | undefined

  get stopped(): boolean {
    return this.stopRequested
  }

  isSkipped(project: string): boolean {
    return this.skippedProjects.has(project)
  }

  skip(project: string): void {
    this.skippedProjects.add(project)
    if (this.running?.projects.has(project) === true) this.running.cancel()
  }

  stop(): void {
    this.stopRequested = true
    this.running?.cancel()
  }

  attach(projects: ReadonlySet<string>, cancel: () => void): void {
    this.running = { projects, cancel }
    if (this.stopRequested || [...projects].some((project) => this.skippedProjects.has(project))) cancel()
  }

  detach(): void {
    this.running = undefined
  }
}

export type SharedSubunitLogger = (message: string, data?: unknown) => void

let sharedSubunitLogger: SharedSubunitLogger = () => {}

export function configureSharedSubunitLogger(logger: SharedSubunitLogger | undefined): void {
  sharedSubunitLogger = logger ?? (() => {})
}

export function log(message: string, data?: unknown): void {
  sharedSubunitLogger(message, data)
}

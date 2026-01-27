export interface MdselEnforcerConfig {
  /** Whether mdsel enforcement is enabled */
  enabled: boolean
  /** Minimum word count to trigger enforcement */
  minWords: number
}

export const DEFAULT_CONFIG: MdselEnforcerConfig = {
  enabled: true,
  minWords: 200,
}

import type { FingerprintFamily } from "../fingerprint"

export function buildNavigatorOverrideScript(family: FingerprintFamily): string {
  return `
;(function () {
  try {
    Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(family.platform)}, configurable: true })
  } catch (e) { void e }
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${JSON.stringify(family.hardwareConcurrency)}, configurable: true })
  } catch (e) { void e }
  try {
    Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(family.locale)}, configurable: true })
    Object.defineProperty(navigator, 'languages', { get: () => Object.freeze([${JSON.stringify(family.locale)}, 'en']), configurable: true })
  } catch (e) { void e }
})();
`.trim()
}

export const RUN_IT_YOURSELF = "Run `omo sync enable` yourself in a terminal."

const DESKTOP_SETUP = "To set up your first device, use the OmO desktop app on a device that supports passkey setup."
export const CREATION_UNAVAILABLE = `Recovery setup is unavailable in this CLI. ${DESKTOP_SETUP}`

export const phraseCreationGuidance = {
  disabled: `Recovery phrase setup is disabled in this CLI. ${DESKTOP_SETUP}`,
  "service-floor-off":
    "OmO could not confirm that the service accepts recovery phrases for this account. First-device setup stopped. Try again later.",
  "no-surface": RUN_IT_YOURSELF,
}

/** the per-account phrase gate: the service names the devices that must update before the first recovery phrase is accepted. */
export const updateDeviceFirst = (label: string): string =>
  `Update OmO on ${label} first (it is older than 5.1.74), then run \`omo sync enable\` again.`

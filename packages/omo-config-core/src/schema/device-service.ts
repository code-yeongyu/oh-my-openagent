import * as z from "zod"

// `device_service`: the OmO device service bootstrap every interactive omo start runs (install the pinned service,
// connect, hand it the signed-in device). On by default; `enabled: false` skips it entirely, with no install and no
// connection. Whether this account's other devices may control this one is the service's own attach setting
// (`omo remote control on|off`), not this key.
const OmoDeviceServiceSettingsShape = {
  enabled: z.boolean(),
}

export const OmoDeviceServiceSettingsLayerSchema = z.object(OmoDeviceServiceSettingsShape).partial().strict()

export const OmoDeviceServiceSettingsSchema = OmoDeviceServiceSettingsLayerSchema.extend({
  enabled: z.boolean().default(true),
}).strict()

export type OmoDeviceServiceSettings = z.infer<typeof OmoDeviceServiceSettingsSchema>

export interface OmoDeviceServiceConfigView {
  readonly device_service?: { readonly enabled?: boolean }
}

export function isOmoDeviceServiceEnabled(config: OmoDeviceServiceConfigView): boolean {
  return config.device_service?.enabled ?? true
}

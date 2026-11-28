declare module "*/plugin/extensions/omo.js" {
  export const composeOmoSenpiExtension: typeof import("../../extension/compose").composeOmoSenpiExtension
  export const omoSenpiComponents: readonly import("../../extension/types").OmoSenpiComponent[]
}

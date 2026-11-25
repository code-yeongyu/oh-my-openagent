import { instantCall, valueCall } from "../call-spec"
import * as input from "../inputs/account"
import type * as result from "../results/account"

// The devices, account, deviceService and sync namespaces (first-party design 6.3 to 6.6).
export const ACCOUNT_CALLS = {
  "account.whoami": valueCall<result.WhoAmI>()(input.AccountWhoami),
  "account.show": valueCall<result.AccountShowResult>()(input.AccountShow),
  "account.signInCheck": instantCall<result.SignInCheck>()(input.AccountSignInCheck),
  "account.signOut": valueCall<result.SignedOut>()(input.AccountSignOut),
  "account.forget": valueCall<result.Forgotten>()(input.AccountForget),
  "account.store.status": valueCall<result.AccountStore>()(input.AccountStoreStatus),
  "account.store.enable": valueCall<result.AccountStore>()(input.AccountStoreEnable),
  "account.store.disable": valueCall<result.AccountStore>()(input.AccountStoreDisable),
  "devices.list": valueCall<readonly result.LiveDevice[]>()(input.DevicesList),
  "devices.rename": valueCall<result.LiveDevice>()(input.DevicesRename),
  "devices.resolve": valueCall<result.DeviceRow>()(input.DevicesResolve),
  "devices.revoke": valueCall<result.Revoked>()(input.DevicesRevoke),
  "deviceService.status": valueCall<result.DeviceServiceStatus>()(input.DeviceServiceStatus),
  "deviceService.info": valueCall<result.ServiceInfo>()(input.DeviceServiceInfo),
  "deviceService.enable": valueCall<result.Enabled>()(input.DeviceServiceEnable),
  "deviceService.disable": valueCall<result.Enabled>()(input.DeviceServiceDisable),
  "deviceService.control": valueCall<result.ControlState>()(input.DeviceServiceControl),
  "deviceService.setControl": valueCall<result.ControlState>()(input.DeviceServiceSetControl),
  "deviceService.wake": valueCall<result.WakeState>()(input.DeviceServiceWake),
  "deviceService.setWake": valueCall<result.WakeState>()(input.DeviceServiceSetWake),
  "deviceService.bootstrap": valueCall<result.BootstrapResult>()(input.DeviceServiceBootstrap),
  "sync.status": valueCall<result.SyncStatusReport>()(input.SyncStatus),
  "sync.disable": valueCall<result.SyncDisabled>()(input.SyncDisable),
  "sync.approve": valueCall<result.SyncApproved>()(input.SyncApprove),
  "sync.retirePin": valueCall<result.PinRetired>()(input.SyncRetirePin),
} as const

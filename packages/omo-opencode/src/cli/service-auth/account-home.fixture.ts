import { systemPlatformFacts, userRecordHome } from "./account-home"

process.stdout.write(userRecordHome(systemPlatformFacts) ?? "")

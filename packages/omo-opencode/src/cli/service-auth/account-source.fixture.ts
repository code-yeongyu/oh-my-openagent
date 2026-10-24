export {}

const runtimePath = "../../../../omo-senpi/plugin/extensions/omo-device-account.js"
const { createCliAccountSource } = await import(runtimePath)

const api = process.env.OMO_SERVICE_API_URL
if (api === undefined) throw new Error("Missing synthetic service origin")
const account = await createCliAccountSource({ api })()
console.log(JSON.stringify(account === null ? null : { accountId: account.accountId, accessToken: await account.accessToken() }))

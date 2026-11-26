// The thread fixture runs its fake device's single-probe locates through the port's real lookup gate. Test helpers may
// reach the remote layer directly (exempt from the remote import guard, v6 V6); the public barrel stays as it is.
export { createLookupGate } from "../../remote/port/lookup-gate"

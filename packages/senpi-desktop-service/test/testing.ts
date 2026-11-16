// The package's public test entry, `@oh-my-opencode/senpi-desktop-service/testing`: other packages' tests reach the
// scripted fake engine and its harness through this module, never by a relative path into test/.
export { FAKE_ENGINE_PATH, fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness"

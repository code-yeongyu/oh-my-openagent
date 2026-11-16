import { dlopen, FFIType, read } from "bun:ffi"
import { closeSync, constants, openSync, writeSync } from "node:fs"

const EV_SYN = 0
const EV_KEY = 1
const UI_SET_EVBIT = 0x40045564n
const UI_SET_KEYBIT = 0x40045565n
const UI_DEV_SETUP = 0x405c5503n
const UI_DEV_CREATE = 0x5501n
const UI_DEV_DESTROY = 0x5502n
const BUS_VIRTUAL = 0x06
const SETUP_BYTES = 92
const EVENT_BYTES = 24

const libc = dlopen("libc.so.6", {
  ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  __errno_location: { args: [], returns: FFIType.ptr },
})

function ioctl(fd: number, request: bigint, arg: number | Uint8Array | null, label: string): void {
  if (libc.symbols.ioctl(fd, request, arg) >= 0) return
  const errnoPtr = libc.symbols.__errno_location()
  throw new Error(`${label} failed, errno ${errnoPtr === null ? "unknown" : read.i32(errnoPtr, 0)}`)
}

function setupStruct(name: string): Uint8Array {
  const setup = new Uint8Array(SETUP_BYTES)
  const view = new DataView(setup.buffer)
  view.setUint16(0, BUS_VIRTUAL, true)
  view.setUint16(2, 0x4f4d, true)
  view.setUint16(4, 0x0007, true)
  view.setUint16(6, 1, true)
  setup.set(new TextEncoder().encode(name).subarray(0, 79), 8)
  return setup
}

export class VirtualKeyboard {
  private constructor(
    private readonly fd: number,
    readonly name: string,
  ) {}

  static create(name: string): VirtualKeyboard {
    const fd = openSync("/dev/uinput", constants.O_WRONLY | constants.O_NONBLOCK)
    try {
      ioctl(fd, UI_SET_EVBIT, EV_KEY, "UI_SET_EVBIT")
      // udev tags ID_INPUT_KEYBOARD only when the low key range is present, so every key 1-255 is declared
      for (let key = 1; key < 256; key++) ioctl(fd, UI_SET_KEYBIT, key, "UI_SET_KEYBIT")
      ioctl(fd, UI_DEV_SETUP, setupStruct(name), "UI_DEV_SETUP")
      ioctl(fd, UI_DEV_CREATE, null, "UI_DEV_CREATE")
    } catch (error) {
      closeSync(fd)
      throw error
    }
    return new VirtualKeyboard(fd, name)
  }

  private emit(type: number, code: number, value: number): void {
    const event = new Uint8Array(EVENT_BYTES)
    const view = new DataView(event.buffer)
    view.setUint16(16, type, true)
    view.setUint16(18, code, true)
    view.setInt32(20, value, true)
    writeSync(this.fd, event)
  }

  tap(code: number): void {
    this.emit(EV_KEY, code, 1)
    this.emit(EV_SYN, 0, 0)
    this.emit(EV_KEY, code, 0)
    this.emit(EV_SYN, 0, 0)
  }

  destroy(): void {
    try {
      ioctl(this.fd, UI_DEV_DESTROY, null, "UI_DEV_DESTROY")
    } finally {
      closeSync(this.fd)
    }
  }
}

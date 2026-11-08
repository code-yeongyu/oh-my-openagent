import { connect } from "node:net"

const socket = connect(Number(process.env.REFLECTION_SLOT_TEST_PORT), "127.0.0.1")
socket.once("connect", () => socket.write(`${process.env.REFLECTION_SLOT_TEST_ID}\n`))
socket.resume()
socket.once("end", () => socket.end())
socket.once("error", (error) => { throw error })

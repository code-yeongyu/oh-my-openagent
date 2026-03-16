import { pollLoop } from "./reply-listener"

pollLoop().catch((err) => {
  console.error(err)
  process.exit(1)
})

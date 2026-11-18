// Stops the server as Azure Container Apps stops a replica: no new connections, a bounded wait for open requests (the
// platform allows 30 seconds), then exit.
import type { Server } from 'node:http'

export interface ShutdownOptions {
  // How long open requests may finish before their connections are closed.
  drainMs: number
  exit: (code: number) => void
}

export function createShutdown(server: Server, options: ShutdownOptions): () => void {
  let stopping = false
  return () => {
    if (stopping) return
    stopping = true
    const drain = setTimeout(() => server.closeAllConnections(), options.drainMs)
    server.close(() => {
      clearTimeout(drain)
      options.exit(0)
    })
    server.closeIdleConnections()
  }
}

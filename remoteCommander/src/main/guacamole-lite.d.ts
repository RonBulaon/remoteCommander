// Minimal type declarations for guacamole-lite (no official types).
declare module 'guacamole-lite' {
  import type { Server as HttpServer } from 'http'

  interface WsOptions {
    server?: HttpServer
    port?: number
  }
  interface GuacdOptions {
    host?: string
    port?: number
  }
  interface ClientOptions {
    crypt: { cypher: string; key: Buffer | string }
    log?: { level?: string | number }
    maxInactivityTime?: number
  }

  export default class GuacamoleLite {
    constructor(ws: WsOptions, guacd: GuacdOptions, client: ClientOptions, callbacks?: unknown)
    close(): void
    on(event: string, cb: (...args: unknown[]) => void): void
  }
}

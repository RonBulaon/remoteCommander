// Minimal type declarations for guacamole-common-js (the bits we use).
declare module 'guacamole-common-js' {
  interface GuacMouseState {
    x: number
    y: number
  }

  export interface GuacDisplay {
    getElement(): HTMLElement
    scale(scale: number): void
    getWidth(): number
    getHeight(): number
    showCursor(shown: boolean): void
  }

  export interface GuacTunnel {
    /* opaque */
    state: number
  }

  export interface GuacClient {
    connect(data: string): void
    disconnect(): void
    getDisplay(): GuacDisplay
    sendMouseState(state: GuacMouseState, applyDisplayScale?: boolean): void
    sendKeyEvent(pressed: number, keysym: number): void
    sendSize(width: number, height: number): void
    onstatechange: ((state: number) => void) | null
    onerror: ((status: { code?: number; message?: string }) => void) | null
    onname: ((name: string) => void) | null
  }

  interface GuacMouseEvent {
    state: GuacMouseState
  }

  interface GuacMouse {
    onEach(events: string[], handler: (e: GuacMouseEvent) => void): void
    on(event: string, handler: (e: GuacMouseEvent) => void): void
  }

  export interface GuacKeyboard {
    onkeydown: ((keysym: number) => void) | null
    onkeyup: ((keysym: number) => void) | null
    reset(): void
  }

  interface GuacamoleStatic {
    Client: { new (tunnel: GuacTunnel): GuacClient }
    WebSocketTunnel: { new (url: string): GuacTunnel }
    Mouse: { new (element: Element): GuacMouse }
    Keyboard: { new (element: Element | Document): GuacKeyboard }
  }

  const Guacamole: GuacamoleStatic
  export default Guacamole
}

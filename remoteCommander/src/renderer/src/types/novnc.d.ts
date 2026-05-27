// Type declarations for @novnc/novnc (official noVNC package).
// The package exports its main entry point as the root import.
declare module '@novnc/novnc' {
  interface RfbOptions {
    credentials?: { username?: string; password?: string; target?: string }
    shared?: boolean
    repeaterID?: string
    wsProtocols?: string[]
  }

  interface ConnectDetail { hwresize: boolean }
  interface DisconnectDetail { clean: boolean }
  interface CredentialsRequiredDetail { types: string[] }
  interface SecurityFailureDetail { status: number; reason?: string }
  interface DesktopNameDetail { name: string }

  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket | RTCDataChannel,
      options?: RfbOptions,
    )

    disconnect(): void
    sendCredentials(creds: { username?: string; password?: string; target?: string }): void
    sendKey(keysym: number, code: string, down?: boolean): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void

    get scaleViewport(): boolean
    set scaleViewport(value: boolean)
    get resizeSession(): boolean
    set resizeSession(value: boolean)
    get viewOnly(): boolean
    set viewOnly(value: boolean)
    get qualityLevel(): number
    set qualityLevel(value: number)
    get compressionLevel(): number
    set compressionLevel(value: number)
    get clipViewport(): boolean
    set clipViewport(value: boolean)

    addEventListener(type: 'connect', handler: (e: CustomEvent<ConnectDetail>) => void): void
    addEventListener(type: 'disconnect', handler: (e: CustomEvent<DisconnectDetail>) => void): void
    addEventListener(type: 'credentialsrequired', handler: (e: CustomEvent<CredentialsRequiredDetail>) => void): void
    addEventListener(type: 'securityfailure', handler: (e: CustomEvent<SecurityFailureDetail>) => void): void
    addEventListener(type: 'desktopname', handler: (e: CustomEvent<DesktopNameDetail>) => void): void
    addEventListener(type: 'bell', handler: (e: CustomEvent) => void): void
    addEventListener(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
    removeEventListener(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
  }
}

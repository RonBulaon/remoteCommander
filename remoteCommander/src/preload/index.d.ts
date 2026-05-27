import { ElectronAPI } from '@electron-toolkit/preload'

export interface ElectronCustomAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  /** Returns an unsubscribe function. */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: ElectronCustomAPI
  }
}

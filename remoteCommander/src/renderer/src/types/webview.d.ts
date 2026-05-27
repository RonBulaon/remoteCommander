// Minimal typings for Electron's <webview> tag, hand-rolled to keep the
// renderer project free of an `electron` type dependency (same approach as
// novnc.d.ts). Only the members WebTab actually uses are declared.

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/** Subset of Electron's WebviewTag API used by the app. */
export interface WebviewTag extends HTMLElement {
  src: string
  getURL(): string
  getTitle(): string
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  reload(): void
  reloadIgnoringCache(): void
  stop(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  isLoading(): boolean
  setZoomLevel(level: number): void
  openDevTools(): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

/** Attributes accepted by the <webview> element. */
interface WebviewHTMLAttributes<T> extends HTMLAttributes<T> {
  src?: string
  partition?: string
  allowpopups?: boolean
  useragent?: string
  // Electron expects lowercase string attributes; React passes them through.
  webpreferences?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<WebviewHTMLAttributes<WebviewTag>, WebviewTag>
    }
  }
}

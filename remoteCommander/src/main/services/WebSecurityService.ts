// Tracks which origins the user has explicitly opted into trusting despite an
// invalid/self-signed TLS certificate (per-profile "Ignore certificate errors"
// for device BMCs/iDRAC/iLO/ESXi). The certificate-error handler in index.ts
// consults this allowlist; nothing else bypasses TLS validation.

function normalizeOrigin(input: string): string | null {
  try {
    // Accepts a full URL or a bare origin; returns scheme://host[:port].
    return new URL(input).origin
  } catch {
    return null
  }
}

// Details of the most recent rejected certificate, captured per guest webContents
// so the renderer can show a browser-style interstitial ("Proceed anyway") and,
// if the user opts in, allowlist the origin and reload.
export interface CertErrorInfo {
  url: string
  error: string
  certificate: {
    subjectName: string
    issuerName: string
    validStart: number
    validExpiry: number
    fingerprint: string
    serialNumber: string
  }
}

export class WebSecurityService {
  private static allowed = new Set<string>()
  private static lastCertError = new Map<number, CertErrorInfo>()

  /** Opt an origin into ignoring cert errors. Returns the normalized origin. */
  static allowOrigin(input: string): string | null {
    const origin = normalizeOrigin(input)
    if (origin) WebSecurityService.allowed.add(origin)
    return origin
  }

  static revokeOrigin(input: string): void {
    const origin = normalizeOrigin(input)
    if (origin) WebSecurityService.allowed.delete(origin)
  }

  /** True if `url`'s origin was explicitly opted in. */
  static isAllowed(url: string): boolean {
    const origin = normalizeOrigin(url)
    return origin != null && WebSecurityService.allowed.has(origin)
  }

  /** Stash the cert that was just rejected for a given guest webContents. */
  static recordCertError(webContentsId: number, info: CertErrorInfo): void {
    WebSecurityService.lastCertError.set(webContentsId, info)
  }

  /** Read and clear the last rejected cert for a guest webContents. */
  static takeCertError(webContentsId: number): CertErrorInfo | null {
    const info = WebSecurityService.lastCertError.get(webContentsId) ?? null
    WebSecurityService.lastCertError.delete(webContentsId)
    return info
  }
}

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Session {
  id: string        // sessionId returned by backend
  tabId: string
  profileId: string
  protocol: 'ssh' | 'sftp' | 'rdp' | 'vnc'
  status: SessionStatus
  connectedAt?: number  // epoch ms
  error?: string
}

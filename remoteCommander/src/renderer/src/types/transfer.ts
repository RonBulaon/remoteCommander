export type TransferDirection = 'upload' | 'download'
export type TransferStatus = 'queued' | 'in_progress' | 'complete' | 'error' | 'cancelled'

export interface FileEntry {
  name: string
  size: number
  mtime: number
  permissions: string
  isDir: boolean
  isSymlink: boolean
}

export interface Transfer {
  id: string
  sessionId: string
  direction: TransferDirection
  localPath: string
  remotePath: string
  filename: string
  totalBytes: number
  transferredBytes: number
  status: TransferStatus
  speed: number       // bytes/sec
  eta?: number        // seconds remaining
  error?: string
}

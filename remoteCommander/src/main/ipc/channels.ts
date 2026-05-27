// All IPC channel name constants.
// Renderer → Main: use ipcRenderer.invoke() or ipcRenderer.send()
// Main → Renderer: use webContents.send() with session-scoped suffixes e.g. ssh:data:{sessionId}

export const Ch = {
  // ── Local terminal ──────────────────────────────────────────────────────
  LOCAL_CONNECT:    'local:connect',     // invoke (cols, rows) → { sessionId }
  LOCAL_DATA_IN:    'local:data',        // send (sessionId, data) user→pty
  LOCAL_RESIZE:     'local:resize',      // invoke (sessionId, cols, rows)
  LOCAL_DISCONNECT: 'local:disconnect',  // invoke (sessionId)
  LOCAL_DATA_OUT:   'local:data:out',    // event prefix; actual: local:data:{sessionId}
  LOCAL_STATUS:     'local:status',      // event prefix; actual: local:status:{sessionId}

  // ── SSH (active) ──────────────────────────────────────────────────────────
  SSH_CONNECT:    'ssh:connect',      // invoke → { sessionId }
  SSH_DATA_IN:    'ssh:data',         // send   (sessionId, data) user→shell
  SSH_DATA_OUT:   'ssh:data:out',     // event prefix; actual: ssh:data:{sessionId}
  SSH_RESIZE:     'ssh:resize',       // invoke (sessionId, cols, rows)
  SSH_DISCONNECT: 'ssh:disconnect',   // invoke (sessionId)
  SSH_STATUS:     'ssh:status',       // event prefix; actual: ssh:status:{sessionId}

  // ── SFTP ──────────────────────────────────────────────────────────────────
  SFTP_CONNECT:          'sftp:connect',
  SFTP_DISCONNECT:       'sftp:disconnect',
  SFTP_LIST:             'sftp:list',
  SFTP_LIST_LOCAL:       'sftp:listLocal',
  SFTP_UPLOAD:           'sftp:upload',
  SFTP_DOWNLOAD:         'sftp:download',
  SFTP_DELETE:           'sftp:delete',
  SFTP_MKDIR:            'sftp:mkdir',
  SFTP_RENAME:           'sftp:rename',
  SFTP_CHMOD:            'sftp:chmod',
  SFTP_READ_FILE:        'sftp:readFile',       // invoke (sessionId, path) → { content } | { error }
  SFTP_WRITE_FILE:       'sftp:writeFile',      // invoke (sessionId, path, content) → { ok } | { error }
  SFTP_READ_LOCAL_FILE:  'sftp:readLocalFile',  // invoke (path) → { content } | { error }
  SFTP_WRITE_LOCAL_FILE: 'sftp:writeLocalFile', // invoke (path, content) → { ok } | { error }
  SFTP_CANCEL_TRANSFER:  'sftp:cancelTransfer',
  SFTP_PROGRESS:         'sftp:progress',  // event prefix; actual: sftp:progress:{transferId}
  SFTP_STATUS:           'sftp:status',    // event prefix; actual: sftp:status:{sessionId}

  // ── RDP ───────────────────────────────────────────────────────────────────
  RDP_CONNECT:        'rdp:connect',        // external FreeRDP window (fallback)
  RDP_DISCONNECT:     'rdp:disconnect',
  RDP_DETECT_BINARY:  'rdp:detectBinary',
  RDP_STATUS:         'rdp:status',   // event prefix
  RDP_GUAC_CONNECT:    'rdp:guacConnect',    // in-tab via guacd → { sessionId, wsPort, token }
  RDP_GUAC_DISCONNECT: 'rdp:guacDisconnect',

  // ── VNC (stub) ────────────────────────────────────────────────────────────
  VNC_CONNECT:    'vnc:connect',
  VNC_DISCONNECT: 'vnc:disconnect',
  VNC_STATUS:     'vnc:status',       // event prefix

  // ── VPN (stub) ────────────────────────────────────────────────────────────
  VPN_CONNECT:        'vpn:connect',
  VPN_DISCONNECT:     'vpn:disconnect',
  VPN_GET_STATUS:     'vpn:getStatus',
  VPN_STATUS:         'vpn:status',   // event prefix
  VPN_LIST_PROFILES:  'vpn:listProfiles',
  VPN_SAVE_PROFILE:   'vpn:saveProfile',
  VPN_DELETE_PROFILE: 'vpn:deleteProfile',

  // ── Web console ─────────────────────────────────────────────────────────
  WEB_ALLOW_INSECURE_CERTS:  'web:allowInsecureCerts',  // invoke (origin|url) → { origin: string | null }
  WEB_REVOKE_INSECURE_CERTS: 'web:revokeInsecureCerts', // invoke (origin|url) → { ok: true }
  WEB_GET_CERT_ERROR:        'web:getCertError',        // invoke (webContentsId) → CertErrorInfo | null
  WEB_SET_PROXY:             'web:setProxy',            // invoke (partition, proxyRules) → { ok }

  // ── Credentials ───────────────────────────────────────────────────────────
  CREDS_SET:    'credentials:set',
  CREDS_GET:    'credentials:get',
  CREDS_DELETE: 'credentials:delete',

  // ── Profile store (persistence) ───────────────────────────────────────────
  STORE_LOAD: 'store:loadProfiles',   // invoke → { groups, profiles }
  STORE_SAVE: 'store:saveProfiles',   // invoke (groups, profiles) → { ok }

  // ── Workspaces ──────────────────────────────────────────────────────────────
  WORKSPACES_LOAD: 'workspaces:load', // invoke → Workspace[]
  WORKSPACES_SAVE: 'workspaces:save', // invoke (workspaces) → { ok }

  // ── Audit log ─────────────────────────────────────────────────────────────
  AUDIT_QUERY:  'audit:query',  // invoke (filters) → ConnectionEvent[]
  AUDIT_EXPORT: 'audit:export', // invoke (filters) → { csv }

  // ── Import / export ───────────────────────────────────────────────────────
  PROFILES_EXPORT: 'profiles:export', // invoke ({ profiles, groups, password }) → { ok }
  PROFILES_IMPORT: 'profiles:import', // invoke ({ password }) → { profiles, groups } | { error }

  // ── Native dialogs ────────────────────────────────────────────────────────
  DIALOG_OPEN_FILE: 'dialog:openFile', // invoke (options) → { filePath: string | null }

  // ── Menu events (main → renderer, one-way) ────────────────────────────────
  MENU_EXPORT: 'menu:export-profiles',
  MENU_IMPORT: 'menu:import-profiles',
  MENU_CONNECTION_HISTORY: 'menu:connection-history',
  MENU_ABOUT: 'menu:about',
} as const

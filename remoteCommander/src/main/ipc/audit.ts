import { ipcMain } from 'electron'
import { Ch } from './channels'
import { AuditService, AuditFilters } from '../services/AuditService'

export function registerAuditHandlers(): void {
  ipcMain.handle(Ch.AUDIT_QUERY, (_e, filters: AuditFilters = {}) => {
    return { events: AuditService.query(filters) }
  })

  ipcMain.handle(Ch.AUDIT_EXPORT, (_e, filters: AuditFilters = {}) => {
    return { csv: AuditService.exportCsv(filters) }
  })
}

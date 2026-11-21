import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { listLibrary, openExternally } from '../services/library/library'

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.libraryList, () => listLibrary())
  ipcMain.handle(IPC.libraryOpenExternal, (_e, id: unknown) => (typeof id === 'string' ? openExternally(id) : false))
}

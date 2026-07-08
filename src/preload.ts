import { contextBridge, ipcRenderer } from 'electron';

const api = {
  pickPng: (): Promise<{ dataUrl: string; fileName: string } | null> =>
    ipcRenderer.invoke('pick-png'),

  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('pick-folder', defaultPath),

  saveIffDialog: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('save-iff-dialog', defaultName),

  writeFile: (filePath: string, data: number[]): Promise<boolean> =>
    ipcRenderer.invoke('write-file', filePath, data),

  readTextFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-text-file', filePath),

  loadPngFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('load-png-file', filePath),

  listDirectory: (dirPath: string): Promise<{ path: string; folders: string[]; files: string[] } | null> =>
    ipcRenderer.invoke('list-directory', dirPath),

  exportAmiga: (data: { projectFolder: string; iffData: number[]; iffBitplanes: number; mapsAb3Data: number[]; gameAb3Data: number[] }): Promise<boolean> =>
    ipcRenderer.invoke('export-amiga', data)
};

contextBridge.exposeInMainWorld('editorApi', api);
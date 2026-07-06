"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    pickPng: () => electron_1.ipcRenderer.invoke('pick-png'),
    pickFolder: (defaultPath) => electron_1.ipcRenderer.invoke('pick-folder', defaultPath),
    saveIffDialog: (defaultName) => electron_1.ipcRenderer.invoke('save-iff-dialog', defaultName),
    writeFile: (filePath, data) => electron_1.ipcRenderer.invoke('write-file', filePath, data),
    readTextFile: (filePath) => electron_1.ipcRenderer.invoke('read-text-file', filePath),
    loadPngFile: (filePath) => electron_1.ipcRenderer.invoke('load-png-file', filePath),
    listDirectory: (dirPath) => electron_1.ipcRenderer.invoke('list-directory', dirPath),
    exportAmiga: (data) => electron_1.ipcRenderer.invoke('export-amiga', data)
};
electron_1.contextBridge.exposeInMainWorld('editorApi', api);
//# sourceMappingURL=preload.js.map
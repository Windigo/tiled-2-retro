"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function isSafePath(p) {
    return typeof p === 'string' && p.length > 0 && !p.includes('\0') && path.isAbsolute(p);
}
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1100,
        height: 700,
        title: 'RetroMapEditor — AmiBlitz3 Map Tool',
        resizable: true,
        fullscreen: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.loadFile('index.html');
    win.setMenuBarVisibility(false);
    win.setMenu(null);
}
// ─── IPC: File dialogs ──────────────────────────────────────────────────────
electron_1.ipcMain.handle('pick-png', async () => {
    const result = await electron_1.dialog.showOpenDialog({
        title: 'Select PNG File',
        filters: [{ name: 'PNG Images', extensions: ['png'] }],
        properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    const filePath = result.filePaths[0];
    try {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        return { dataUrl: `data:image/png;base64,${base64}`, fileName: path.basename(filePath) };
    }
    catch (err) {
        console.error('Failed to read PNG:', err);
        return null;
    }
});
electron_1.ipcMain.handle('pick-folder', async (_event, defaultPath) => {
    const opts = {
        title: 'Select Folder',
        properties: ['openDirectory', 'createDirectory']
    };
    if (defaultPath)
        opts.defaultPath = defaultPath;
    const result = await electron_1.dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0)
        return null;
    return result.filePaths[0];
});
electron_1.ipcMain.handle('save-iff-dialog', async (_event, defaultName) => {
    const result = await electron_1.dialog.showSaveDialog({
        title: 'Save IFF File',
        defaultPath: defaultName || 'output.iff',
        filters: [{ name: 'IFF/ILBM', extensions: ['iff', 'ilbm'] }]
    });
    if (result.canceled || !result.filePath)
        return null;
    return result.filePath;
});
electron_1.ipcMain.handle('write-file', async (_event, filePath, data) => {
    if (!isSafePath(filePath))
        return false;
    try {
        fs.writeFileSync(filePath, Buffer.from(data));
        return true;
    }
    catch (err) {
        console.error('Failed to write file:', err);
        return false;
    }
});
electron_1.ipcMain.handle('read-text-file', async (_event, filePath) => {
    if (!isSafePath(filePath))
        return null;
    try {
        return fs.readFileSync(filePath, 'utf-8');
    }
    catch (err) {
        console.error('Failed to read text file:', err);
        return null;
    }
});
electron_1.ipcMain.handle('load-png-file', async (_event, filePath) => {
    if (!isSafePath(filePath))
        return null;
    try {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        return `data:image/png;base64,${base64}`;
    }
    catch (err) {
        console.error('Failed to read PNG file:', err);
        return null;
    }
});
electron_1.ipcMain.handle('list-directory', async (_event, dirPath) => {
    if (!isSafePath(dirPath))
        return null;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const folders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
        const files = entries.filter(e => e.isFile()).map(e => e.name).sort();
        return { path: dirPath, folders, files };
    }
    catch {
        return null;
    }
});
electron_1.ipcMain.handle('export-amiga', async (_event, data) => {
    if (!isSafePath(data.projectFolder))
        return false;
    try {
        const amigaDir = path.join(data.projectFolder, 'amiga');
        fs.mkdirSync(amigaDir, { recursive: true });
        fs.writeFileSync(path.join(amigaDir, `tiles_${data.iffBitplanes}bp.iff`), Buffer.from(data.iffData));
        fs.writeFileSync(path.join(amigaDir, 'maps.ab3'), Buffer.from(data.mapsAb3Data));
        fs.writeFileSync(path.join(amigaDir, 'game.ab3'), Buffer.from(data.gameAb3Data));
        fs.writeFileSync(path.join(amigaDir, 'player.ab3'), Buffer.from(data.playerAb3Data));
        return true;
    }
    catch (err) {
        console.error('Failed to export Amiga files:', err);
        return false;
    }
});
// ─── App lifecycle ────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
//# sourceMappingURL=main.js.map
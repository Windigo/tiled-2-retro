import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

function isSafePath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && !p.includes('\0') && path.isAbsolute(p);
}

function createWindow(): void {
  const win = new BrowserWindow({
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

ipcMain.handle('pick-png', async (): Promise<{ dataUrl: string; fileName: string } | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Select PNG File',
    filters: [{ name: 'PNG Images', extensions: ['png'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return { dataUrl: `data:image/png;base64,${base64}`, fileName: path.basename(filePath) };
  } catch (err) {
    console.error('Failed to read PNG:', err);
    return null;
  }
});

ipcMain.handle('pick-folder', async (_event: unknown, defaultPath?: string): Promise<string | null> => {
  const opts: Electron.OpenDialogOptions = {
    title: 'Select Folder',
    properties: ['openDirectory', 'createDirectory']
  };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('save-iff-dialog', async (_event: unknown, defaultName?: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    title: 'Save IFF File',
    defaultPath: defaultName || 'output.iff',
    filters: [{ name: 'IFF/ILBM', extensions: ['iff', 'ilbm'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('write-file', async (_event: unknown, filePath: string, data: number[]): Promise<boolean> => {
  if (!isSafePath(filePath)) return false;
  try {
    fs.writeFileSync(filePath, Buffer.from(data));
    return true;
  } catch (err) {
    console.error('Failed to write file:', err);
    return false;
  }
});

ipcMain.handle('read-text-file', async (_event: unknown, filePath: string): Promise<string | null> => {
  if (!isSafePath(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Failed to read text file:', err);
    return null;
  }
});

ipcMain.handle('load-png-file', async (_event: unknown, filePath: string): Promise<string | null> => {
  if (!isSafePath(filePath)) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error('Failed to read PNG file:', err);
    return null;
  }
});

ipcMain.handle('list-directory', async (_event: unknown, dirPath: string): Promise<{ path: string; folders: string[]; files: string[] } | null> => {
  if (!isSafePath(dirPath)) return null;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
    const files = entries.filter(e => e.isFile()).map(e => e.name).sort();
    return { path: dirPath, folders, files };
  } catch {
    return null;
  }
});

ipcMain.handle('export-amiga', async (
  _event: unknown,
  data: { projectFolder: string; iffData: number[]; iffBitplanes: number; mapsAb3Data: number[]; gameAb3Data: number[]; playerAb3Data: number[] }
): Promise<boolean> => {
  if (!isSafePath(data.projectFolder)) return false;
  try {
    const amigaDir = path.join(data.projectFolder, 'amiga');
    fs.mkdirSync(amigaDir, { recursive: true });
    fs.writeFileSync(path.join(amigaDir, `tiles_${data.iffBitplanes}bp.iff`), Buffer.from(data.iffData));
    fs.writeFileSync(path.join(amigaDir, 'maps.ab3'), Buffer.from(data.mapsAb3Data));
    fs.writeFileSync(path.join(amigaDir, 'game.ab3'), Buffer.from(data.gameAb3Data));
    fs.writeFileSync(path.join(amigaDir, 'player.ab3'), Buffer.from(data.playerAb3Data));
    return true;
  } catch (err) {
    console.error('Failed to export Amiga files:', err);
    return false;
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
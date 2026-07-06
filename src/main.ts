import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Basic path hardening for renderer-supplied paths: reject empty, non-string,
 * null-byte-injected, or relative paths before touching the filesystem.
 */
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
  win.setMenu(null); // Remove default Electron menu entirely
  win.webContents.openDevTools();
}

// ─── IPC: File dialogs for project workflow ──────────────────────────────────

/** Pick a PNG tilesheet file; returns { dataUrl, fileName } or null. */
ipcMain.handle('pick-png', async (): Promise<{ dataUrl: string; fileName: string } | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Select Tilesheet PNG',
    filters: [{ name: 'PNG Images', extensions: ['png'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return {
      dataUrl: `data:image/png;base64,${base64}`,
      fileName: path.basename(filePath)
    };
  } catch (err) {
    console.error('Failed to read PNG:', err);
    return null;
  }
});

/** Pick a folder path; returns the selected folder path or null. */
ipcMain.handle('pick-folder', async (_event: unknown, defaultPath?: string): Promise<string | null> => {
  const opts: Electron.OpenDialogOptions = {
    title: 'Select Project Folder',
    properties: ['openDirectory', 'createDirectory']
  };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(opts);

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

/** Pick a save-file location for IFF export. */
ipcMain.handle('save-iff-dialog', async (_event: unknown, defaultName?: string): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    title: 'Save IFF File',
    defaultPath: defaultName || 'output.iff',
    filters: [{ name: 'IFF/ILBM', extensions: ['iff', 'ilbm'] }]
  });

  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

/** Write raw bytes to a file (for IFF export). */
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

/**
 * Create a new project: creates a folder at the given path, copies the PNG
 * tilesheet into it, and writes the .project project file.
 * Returns the project folder path on success, null on failure.
 */
ipcMain.handle('create-project', async (
  _event: unknown,
  data: {
    projectName: string;
    folderPath: string;
    pngDataUrl: string;
    pngFileName: string;
    maps: { name: string; map: number[][]; mapCols: number; mapRows: number }[];
    bits: { name: string; color: string }[];
    tileFlags: number[];
    tilesheetCols: number;
    tilesheetRows: number;
    iffData?: number[];
    convBitplanes?: number;
  }
): Promise<string | null> => {
  if (!isSafePath(data.folderPath)) return null;
  try {
    const projectDir = path.join(data.folderPath, data.projectName);
    const amigaDir = path.join(projectDir, 'amiga');

    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(amigaDir, { recursive: true });

    const base64Data = data.pngDataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBuffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(path.join(projectDir, data.pngFileName), pngBuffer);

    // Write IFF file if provided
    if (data.iffData && data.iffData.length > 0) {
      const iffName = data.pngFileName.replace(/\.png$/i, '.iff');
      fs.writeFileSync(path.join(projectDir, iffName), Buffer.from(data.iffData));
    }

    const { pngDataUrl, iffData, ...projectData } = data;
    const projectJson = JSON.stringify(projectData, null, 2);
    fs.writeFileSync(path.join(projectDir, `${data.projectName}.project`), projectJson, 'utf-8');

    return projectDir;
  } catch (err) {
    console.error('Failed to create project:', err);
    return null;
  }
});

/** Save the project file (.project) at the given folder path. */
ipcMain.handle('save-project-file', async (
  _event: unknown,
  data: {
    projectFolder: string;
    projectName: string;
    pngFileName: string;
    maps: { name: string; map: number[][]; mapCols: number; mapRows: number }[];
    bits: { name: string; color: string }[];
    tileFlags: number[];
    tilesheetCols: number;
    tilesheetRows: number;
  }
): Promise<boolean> => {
  try {
    const projectPath = path.join(data.projectFolder, `${data.projectName}.project`);
    const { projectFolder, projectName, ...projectData } = data;
    const projectJson = JSON.stringify(projectData, null, 2);
    fs.writeFileSync(projectPath, projectJson, 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save project file:', err);
    return false;
  }
});

/** Export Amiga files (tiles.iff, maps.ab3, game.ab3, player.ab3) to the project's amiga/ subfolder. */
ipcMain.handle('export-amiga', async (
  _event: unknown,
  data: {
    projectFolder: string;
    iffData: number[];
    mapsAb3Data: number[];
    gameAb3Data: number[];
    playerAb3Data: number[];
  }
): Promise<boolean> => {
  if (!isSafePath(data.projectFolder)) return false;
  try {
    const amigaDir = path.join(data.projectFolder, 'amiga');
    fs.mkdirSync(amigaDir, { recursive: true });

    // ab3 bytes are already normalized to LF line endings and ASCII-sanitized in the renderer.
    fs.writeFileSync(path.join(amigaDir, 'tiles.iff'), Buffer.from(data.iffData));
    fs.writeFileSync(path.join(amigaDir, 'maps.ab3'), Buffer.from(data.mapsAb3Data));
    fs.writeFileSync(path.join(amigaDir, 'game.ab3'), Buffer.from(data.gameAb3Data));
    fs.writeFileSync(path.join(amigaDir, 'player.ab3'), Buffer.from(data.playerAb3Data));
    return true;
  } catch (err) {
    console.error('Failed to export Amiga files:', err);
    return false;
  }
});

/** Check if the amiga/ subfolder in a project contains exported files. */
ipcMain.handle('check-amiga-export', async (_event: unknown, projectFolder: string): Promise<boolean> => {
  try {
    const amigaDir = path.join(projectFolder, 'amiga');
    if (!fs.existsSync(amigaDir)) return false;
    const files = ['tiles.iff', 'maps.ab3', 'game.ab3', 'player.ab3'];
    return files.every(f => fs.existsSync(path.join(amigaDir, f)));
  } catch {
    return false;
  }
});

/** Read a text file from disk. */
ipcMain.handle('read-text-file', async (_event: unknown, filePath: string): Promise<string | null> => {
  if (!isSafePath(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Failed to read text file:', err);
    return null;
  }
});

/** Read a PNG file from disk and return it as a data URL. */
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

/** List a directory; returns { files, folders } for the custom file browser. */
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

/** Load a project file (.project) at the given path. */
ipcMain.handle('load-project-file', async (_event: unknown, filePath: string): Promise<{ projectFolder: string; projectName: string; data: unknown } | null> => {
  if (!isSafePath(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const projectFolder = path.dirname(filePath);
    const projectName = path.basename(filePath, path.extname(filePath));
    return { projectFolder, projectName, data: JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to load project:', err);
    return null;
  }
});

/** Load a project file via native dialog (kept as fallback). */
ipcMain.handle('load-project', async (_event: unknown, defaultPath?: string): Promise<{ projectFolder: string; projectName: string; data: unknown } | null> => {
  const opts: Electron.OpenDialogOptions = {
    title: 'Load Project',
    filters: [{ name: 'RetroMap Project', extensions: ['project'] }],
    properties: ['openFile']
  };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(opts);

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const projectFolder = path.dirname(filePath);
    const projectName = path.basename(filePath, path.extname(filePath));
    return { projectFolder, projectName, data: JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to load project:', err);
    return null;
  }
});

// ─── Legacy IPC (map JSON) ───────────────────────────────────────────────────

ipcMain.handle('load-map-json', async (): Promise<unknown> => {
  const result = await dialog.showOpenDialog({
    title: 'Load Exported Map JSON',
    filters: [{ name: 'JSON Map', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load map JSON:', err);
    return null;
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
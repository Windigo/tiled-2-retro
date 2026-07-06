"use strict";
// ─── Constants ────────────────────────────────────────────────────────────────
const SCALE = 2;
const TOTAL_BITS = 16;
const CONFIG = {
    tileSize: 16,
    scale: SCALE,
    dTile: 16 * SCALE,
    tilesheetCols: 20,
    tilesheetRows: 20,
    mapCols: 20,
    mapRows: 16,
    mapW: 20 * 16,
    mapH: 16 * 16,
    sheetW: 20 * 16,
    sheetH: 20 * 16,
    imgW: 320,
    imgH: 256,
};
function gridSheetCols() { return Math.max(1, Math.floor(CONFIG.imgW / gridTileSize)); }
function gridSheetRows() { return Math.max(1, Math.floor(CONFIG.imgH / gridTileSize)); }
function getMaxTiles() {
    return gridSheetCols() * gridSheetRows();
}
function recalcDerived() {
    CONFIG.dTile = CONFIG.tileSize * CONFIG.scale;
    CONFIG.mapW = CONFIG.mapCols * CONFIG.tileSize;
    CONFIG.mapH = CONFIG.mapRows * CONFIG.tileSize;
    CONFIG.sheetW = CONFIG.tilesheetCols * CONFIG.tileSize;
    CONFIG.sheetH = CONFIG.tilesheetRows * CONFIG.tileSize;
}
function recalcTilesheetFromImage() {
    CONFIG.tilesheetCols = Math.max(1, Math.floor(CONFIG.imgW / CONFIG.tileSize));
    CONFIG.tilesheetRows = Math.max(1, Math.floor(CONFIG.imgH / CONFIG.tileSize));
    recalcDerived();
    tilesCanvas.width = CONFIG.sheetW * CONFIG.scale;
    tilesCanvas.height = CONFIG.sheetH * CONFIG.scale;
}
function resizeCanvases() {
    mapCanvas.width = CONFIG.mapW * CONFIG.scale;
    mapCanvas.height = CONFIG.mapH * CONFIG.scale;
    tilesCanvas.width = CONFIG.sheetW * CONFIG.scale;
    tilesCanvas.height = CONFIG.sheetH * CONFIG.scale;
}
// ─── DOM elements ─────────────────────────────────────────────────────────────
const mapCanvas = document.getElementById('map-canvas');
const mapCtx = mapCanvas.getContext('2d');
const tilesCanvas = document.getElementById('tiles-canvas');
const tilesCtx = tilesCanvas.getContext('2d');
const activeTileSpan = document.getElementById('active-tile-id');
const flagsColumn = document.getElementById('flags-column');
const bitsOnMapCheckbox = document.getElementById('chk-bits-on-map');
const tileSizeSlider = document.getElementById('tile-size-slider');
const tileSizeValue = document.getElementById('tile-size-value');
// ─── State ────────────────────────────────────────────────────────────────────
let maps = [];
let currentMapIndex = 0;
function getCurrentMap() { return maps[currentMapIndex]?.map ?? []; }
function getCurrentMapEntry() { return maps[currentMapIndex]; }
let activeTile = 0;
let mouseDown = false;
let lastPlaced = null;
let sheetHover = { col: -1, row: -1 };
let mapHover = { col: -1, row: -1 };
let tileFlags = new Array(400).fill(0);
let activeBitIndex = 0;
let bitsConfig = { bits: [], tileFlags: [] };
let tilesheet = null;
let projectLoaded = false;
let currentProjectPath = '';
let currentProjectName = '— no project —';
let currentPngFileName = '';
let convBitplanes = 4;
let gridTileSize = 16; // visual grid tile size, changed by slider, saved with project
function gridDTile() { return gridTileSize * CONFIG.scale; }
function gridMapCols() { return Math.max(1, Math.floor(mapCanvas.width / gridDTile())); }
function gridMapRows() { return Math.max(1, Math.floor(mapCanvas.height / gridDTile())); }
function mapCellFromPoint(p) {
    const d = gridDTile();
    return { col: Math.floor(p.x / d), row: Math.floor(p.y / d) };
}
// ─── Ensure tileFlags array is large enough ───────────────────────────────────
function ensureTileFlagsSize() {
    const maxTiles = getMaxTiles();
    while (tileFlags.length < maxTiles)
        tileFlags.push(0);
}
// ─── Bit helpers ──────────────────────────────────────────────────────────────
function hasBit(tileIdx, bitIdx) {
    return (tileFlags[tileIdx] & (1 << bitIdx)) !== 0;
}
function toggleBit(tileIdx, bitIdx) {
    if (bitIdx < 0 || bitIdx >= TOTAL_BITS)
        return;
    tileFlags[tileIdx] ^= (1 << bitIdx);
    tileFlags[tileIdx] &= 0xFFFF;
}
// ─── Init map grid ────────────────────────────────────────────────────────────
function createEmptyGrid(cols, rows) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
        grid[r] = new Array(cols).fill(0);
    }
    return grid;
}
function initSingleMap(cols, rows) {
    return { name: 'Level 1', map: createEmptyGrid(cols, rows), mapCols: cols, mapRows: rows };
}
// ─── Map tabs UI ──────────────────────────────────────────────────────────────
let dragSrcIndex = null;
const mapTabsContainer = document.getElementById('map-tabs');
function renderMapTabs() {
    const container = mapTabsContainer;
    let html = '';
    for (let i = 0; i < maps.length; i++) {
        const entry = maps[i];
        const active = i === currentMapIndex ? ' active' : '';
        html += `<div class="map-tab${active}" data-index="${i}" draggable="true">
      <span class="map-tab-name" data-index="${i}">${entry.name}</span>
      <button class="map-tab-del" data-index="${i}" title="Delete map">&times;</button>
    </div>`;
    }
    html += `<button id="btn-add-map" class="map-tab-add" title="Add new map">+</button>`;
    container.innerHTML = html;
}
mapTabsContainer.addEventListener('click', (e) => {
    const target = e.target;
    if (target.id === 'btn-add-map') {
        addNewMap();
        return;
    }
    if (target.classList.contains('map-tab-del')) {
        const idx = parseInt(target.dataset.index, 10);
        deleteMap(idx);
        return;
    }
    const tab = target.closest('.map-tab');
    if (!tab)
        return;
    const idx = parseInt(tab.dataset.index, 10);
    if (idx === currentMapIndex) {
        startRenameMap(idx);
    }
    else {
        switchToMap(idx);
    }
});
mapTabsContainer.addEventListener('contextmenu', (e) => {
    const target = e.target;
    if (target.classList.contains('map-tab-del'))
        return;
    const tab = target.closest('.map-tab');
    if (!tab)
        return;
    e.preventDefault();
    const idx = parseInt(tab.dataset.index, 10);
    startRenameMap(idx);
});
function updateDropIndicator(clientY) {
    const tabs = mapTabsContainer.querySelectorAll('.map-tab');
    const containerRect = mapTabsContainer.getBoundingClientRect();
    const relativeY = clientY - containerRect.top;
    tabs.forEach(t => t.classList.remove('drop-before', 'drop-after'));
    let bestTab = null;
    let bestDist = Infinity;
    let insertAfter = false;
    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (tab.dataset.index === String(dragSrcIndex))
            continue;
        const r = tab.getBoundingClientRect();
        const top = r.top - containerRect.top;
        const bottom = r.bottom - containerRect.top;
        const mid = top + r.height / 2;
        if (relativeY < mid) {
            const dist = Math.abs(relativeY - top);
            if (dist < bestDist) {
                bestDist = dist;
                bestTab = tab;
                insertAfter = false;
            }
        }
        else {
            const dist = Math.abs(relativeY - bottom);
            if (dist < bestDist) {
                bestDist = dist;
                bestTab = tab;
                insertAfter = true;
            }
        }
    }
    if (bestTab) {
        if (insertAfter)
            bestTab.classList.add('drop-after');
        else
            bestTab.classList.add('drop-before');
    }
    if (!bestTab)
        return maps.length;
    return insertAfter ? parseInt(bestTab.dataset.index, 10) + 1 : parseInt(bestTab.dataset.index, 10);
}
function clearDropIndicators() {
    mapTabsContainer.querySelectorAll('.map-tab.drop-before, .map-tab.drop-after').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
    });
}
mapTabsContainer.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.map-tab');
    if (!tab)
        return;
    dragSrcIndex = parseInt(tab.dataset.index, 10);
    e.dataTransfer.effectAllowed = 'move';
    const gapSize = tab.offsetHeight + 4;
    mapTabsContainer.style.setProperty('--drop-gap', gapSize + 'px');
    tab.querySelectorAll('.map-tab-name, .map-tab-del').forEach(el => el.style.pointerEvents = 'none');
});
mapTabsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSrcIndex === null)
        return;
    updateDropIndicator(e.clientY);
});
mapTabsContainer.addEventListener('dragleave', (e) => {
    const related = e.relatedTarget;
    if (!related || !mapTabsContainer.contains(related))
        clearDropIndicators();
});
mapTabsContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropIndicators();
    if (dragSrcIndex === null)
        return;
    const clientY = e.clientY;
    const tabs = mapTabsContainer.querySelectorAll('.map-tab');
    const containerRect = mapTabsContainer.getBoundingClientRect();
    const relativeY = clientY - containerRect.top;
    let bestTab = null;
    let bestDist = Infinity;
    let insertAfter = false;
    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (tab.dataset.index === String(dragSrcIndex))
            continue;
        const r = tab.getBoundingClientRect();
        const top = r.top - containerRect.top;
        const bottom = r.bottom - containerRect.top;
        const mid = top + r.height / 2;
        const dist = Math.abs(relativeY - (relativeY < mid ? top : bottom));
        if (dist < bestDist) {
            bestDist = dist;
            bestTab = tab;
            insertAfter = relativeY >= mid;
        }
    }
    const idx = bestTab ? (insertAfter ? parseInt(bestTab.dataset.index, 10) + 1 : parseInt(bestTab.dataset.index, 10)) : maps.length;
    const adjustedTo = idx > dragSrcIndex ? idx - 1 : idx;
    if (adjustedTo === dragSrcIndex) {
        dragSrcIndex = null;
        return;
    }
    const [moved] = maps.splice(dragSrcIndex, 1);
    maps.splice(adjustedTo, 0, moved);
    if (dragSrcIndex === currentMapIndex)
        currentMapIndex = adjustedTo;
    else {
        if (dragSrcIndex < currentMapIndex && adjustedTo >= currentMapIndex)
            currentMapIndex--;
        else if (dragSrcIndex > currentMapIndex && adjustedTo <= currentMapIndex)
            currentMapIndex++;
    }
    dragSrcIndex = null;
    renderMapTabs();
    drawMap();
    updateProjectUI();
});
mapTabsContainer.addEventListener('dragend', () => {
    clearDropIndicators();
    mapTabsContainer.querySelectorAll('.map-tab').forEach(el => {
        el.querySelectorAll('.map-tab-name, .map-tab-del').forEach(c => c.style.pointerEvents = '');
    });
    dragSrcIndex = null;
});
function switchToMap(index) {
    if (index < 0 || index >= maps.length)
        return;
    currentMapIndex = index;
    const entry = getCurrentMapEntry();
    CONFIG.mapCols = entry.mapCols;
    CONFIG.mapRows = entry.mapRows;
    recalcDerived();
    mapCanvas.width = CONFIG.mapW * CONFIG.scale;
    mapCanvas.height = CONFIG.mapH * CONFIG.scale;
    renderMapTabs();
    drawMap();
    updateProjectUI();
}
function addNewMap() {
    const defaultCols = CONFIG.mapCols || 20;
    const defaultRows = CONFIG.mapRows || 16;
    const name = 'Level ' + (maps.length + 1);
    const entry = { name, map: createEmptyGrid(defaultCols, defaultRows), mapCols: defaultCols, mapRows: defaultRows };
    maps.push(entry);
    switchToMap(maps.length - 1);
    showToast('Map added: ' + name, 'success');
}
let renameMapIndex = -1;
function startRenameMap(index) {
    const entry = maps[index];
    if (!entry)
        return;
    renameMapIndex = index;
    const input = document.getElementById('input-rename-map');
    const label = document.getElementById('rename-map-label');
    input.value = entry.name;
    label.textContent = 'Rename "' + entry.name + '"';
    document.getElementById('rename-map-overlay').classList.remove('hidden');
    input.focus();
    input.select();
}
function finishRenameMap() {
    if (renameMapIndex < 0 || renameMapIndex >= maps.length) {
        document.getElementById('rename-map-overlay').classList.add('hidden');
        renameMapIndex = -1;
        return;
    }
    const input = document.getElementById('input-rename-map');
    const newName = input.value.trim();
    if (newName && newName !== maps[renameMapIndex].name) {
        maps[renameMapIndex].name = newName;
        renderMapTabs();
        updateProjectUI();
    }
    document.getElementById('rename-map-overlay').classList.add('hidden');
    renameMapIndex = -1;
}
let deleteMapIndex = -1;
function deleteMap(index) {
    if (maps.length <= 1) {
        showToast('Cannot delete the last map', 'error');
        return;
    }
    const entry = maps[index];
    if (!entry)
        return;
    deleteMapIndex = index;
    document.getElementById('delete-map-message').textContent = `Delete "${entry.name}"? This cannot be undone.`;
    document.getElementById('delete-map-overlay').classList.remove('hidden');
}
function confirmDeleteMap() {
    if (deleteMapIndex < 0 || deleteMapIndex >= maps.length) {
        document.getElementById('delete-map-overlay').classList.add('hidden');
        deleteMapIndex = -1;
        return;
    }
    const entry = maps[deleteMapIndex];
    maps.splice(deleteMapIndex, 1);
    if (currentMapIndex >= maps.length)
        currentMapIndex = maps.length - 1;
    if (currentMapIndex === deleteMapIndex && deleteMapIndex > 0)
        currentMapIndex = deleteMapIndex - 1;
    else if (currentMapIndex === deleteMapIndex)
        currentMapIndex = 0;
    switchToMap(currentMapIndex);
    showToast('Map deleted: ' + entry.name, 'success');
    document.getElementById('delete-map-overlay').classList.add('hidden');
    deleteMapIndex = -1;
}
// ─── DEFAULT BITS ─────────────────────────────────────────────────────────────
function ensureBits() {
    while (bitsConfig.bits.length < TOTAL_BITS) {
        bitsConfig.bits.push({ name: '', color: '#888888' });
    }
    bitsConfig.bits = bitsConfig.bits.slice(0, TOTAL_BITS);
}
// ─── Toast ─────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'success', durationMs = 2500) {
    const el = document.getElementById('toast');
    if (toastTimer)
        clearTimeout(toastTimer);
    el.textContent = message;
    el.className = 'toast ' + type;
    void el.offsetWidth;
    el.classList.remove('hidden');
    toastTimer = setTimeout(() => { el.classList.add('hidden'); toastTimer = null; }, durationMs);
}
// ─── Project management ───────────────────────────────────────────────────────
function updateProjectUI() {
    const nameEl = document.getElementById('project-name');
    nameEl.textContent = currentProjectName;
    const mapDims = document.getElementById('map-dims');
    mapDims.textContent = projectLoaded
        ? `${CONFIG.mapCols}×${CONFIG.mapRows} — ${CONFIG.mapW}×${CONFIG.mapH} px — tile ${CONFIG.tileSize}px`
        : '—';
    const sheetDims = document.getElementById('tilesheet-dims');
    sheetDims.textContent = projectLoaded
        ? `${gridSheetCols()}×${gridSheetRows()} tiles — ${gridTileSize}×${gridTileSize} px each — image ${CONFIG.imgW}×${CONFIG.imgH}px`
        : '—';
}
function loadTilesheetFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { resolve(img); };
        img.onerror = () => { reject(new Error('Failed to load tilesheet image')); };
        img.src = dataUrl;
    });
}
function clearEditor() {
    setPreviewEnabled(false);
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    tilesCtx.clearRect(0, 0, tilesCanvas.width, tilesCanvas.height);
    maps = [];
    currentMapIndex = 0;
    activeBitIndex = 0;
    bitsConfig = { bits: [], tileFlags: [] };
    tileFlags = new Array(400).fill(0);
    flagsColumn.innerHTML = '';
    sheetHover = { col: -1, row: -1 };
    mapHover = { col: -1, row: -1 };
    activeTile = 0;
    gridTileSize = 16;
    renderMapTabs();
    updateActiveDisplay();
    updateProjectUI();
    tileSizeSlider.value = '16';
    tileSizeValue.textContent = '16';
}
async function createNewProject(projectName, folderPath, pngDataUrl, pngFileName, sheetCols, sheetRows, mapCols, mapRows, firstMapName, tileSize, imgW, imgH, iffData, bitplanes) {
    CONFIG.tileSize = tileSize;
    gridTileSize = tileSize;
    CONFIG.mapCols = mapCols;
    CONFIG.mapRows = mapRows;
    CONFIG.tilesheetCols = sheetCols;
    CONFIG.tilesheetRows = sheetRows;
    CONFIG.imgW = imgW;
    CONFIG.imgH = imgH;
    recalcDerived();
    mapCanvas.width = CONFIG.mapW * CONFIG.scale;
    mapCanvas.height = CONFIG.mapH * CONFIG.scale;
    tilesCanvas.width = CONFIG.sheetW * CONFIG.scale;
    tilesCanvas.height = CONFIG.sheetH * CONFIG.scale;
    const initialMap = { name: firstMapName, map: createEmptyGrid(mapCols, mapRows), mapCols, mapRows };
    maps = [initialMap];
    currentMapIndex = 0;
    const maxTiles = getMaxTiles();
    tileFlags = new Array(maxTiles).fill(0);
    bitsConfig = {
        bits: [
            { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' },
            { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' },
            { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' },
            { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' }, { name: '', color: '#888888' },
        ],
        tileFlags: new Array(maxTiles).fill(0)
    };
    ensureBits();
    const resultPath = await editorApi.createProject({ projectName, folderPath, pngDataUrl, pngFileName,
        maps: maps.map(m => ({ ...m, map: m.map.map(row => [...row]) })),
        bits: bitsConfig.bits, tileFlags: [...tileFlags],
        tilesheetCols: CONFIG.tilesheetCols, tilesheetRows: CONFIG.tilesheetRows,
        tileSize: CONFIG.tileSize, gridTileSize,
        iffData, convBitplanes: bitplanes
    });
    if (!resultPath) {
        console.error('Failed to create project folder');
        return false;
    }
    try {
        tilesheet = await loadTilesheetFromDataUrl(pngDataUrl);
        projectLoaded = true;
    }
    catch (err) {
        console.error(err);
        return false;
    }
    currentProjectPath = resultPath;
    currentProjectName = projectName;
    currentPngFileName = pngFileName;
    const parentFolder = folderPath.substring(0, folderPath.lastIndexOf('/'));
    if (parentFolder)
        localStorage.setItem('lastProjectFolder', parentFolder);
    activeBitIndex = 0;
    tileSizeSlider.value = String(gridTileSize);
    tileSizeValue.textContent = String(gridTileSize);
    renderMapTabs();
    renderFlagsUI();
    drawTilesheet();
    drawMap();
    updateActiveDisplay();
    updateProjectUI();
    showToast('Project created: ' + projectName, 'success');
    return true;
}
async function saveProject() {
    if (!projectLoaded || !tilesheet || !currentProjectPath) {
        console.warn('No project to save');
        return;
    }
    const projectName = currentProjectName.replace(/\.project$/, '');
    const success = await editorApi.saveProjectFile({
        projectFolder: currentProjectPath, projectName, pngFileName: currentPngFileName,
        maps: maps.map(m => ({ ...m, map: m.map.map(row => [...row]) })),
        bits: bitsConfig.bits, tileFlags: [...tileFlags],
        tilesheetCols: CONFIG.tilesheetCols, tilesheetRows: CONFIG.tilesheetRows,
        tileSize: CONFIG.tileSize, gridTileSize,
        convBitplanes
    });
    if (success) {
        updateProjectUI();
        showToast('Project saved', 'success');
    }
    else
        showToast('Failed to save project', 'error');
}
async function loadProject() {
    const saved = localStorage.getItem('lastProjectFolder') || undefined;
    const result = await editorApi.loadProject(saved);
    if (!result) {
        showToast('Load cancelled', 'error');
        return;
    }
    await applyLoadedProject(result);
}
async function applyLoadedProject(result) {
    const { projectFolder, projectName, data } = result;
    const tileSize = data.tileSize || 16;
    gridTileSize = data.gridTileSize || tileSize;
    CONFIG.tileSize = tileSize;
    CONFIG.tilesheetCols = data.tilesheetCols;
    CONFIG.tilesheetRows = data.tilesheetRows;
    recalcDerived();
    tilesCanvas.width = CONFIG.sheetW * CONFIG.scale;
    tilesCanvas.height = CONFIG.sheetH * CONFIG.scale;
    const pngPath = projectFolder + '/' + data.pngFileName;
    const pngDataUrl = await editorApi.loadPngFile(pngPath);
    if (!pngDataUrl) {
        console.error('Failed to load tilesheet from project folder');
        return;
    }
    let img;
    try {
        img = await loadTilesheetFromDataUrl(pngDataUrl);
    }
    catch (err) {
        console.error('Failed to decode tilesheet:', err);
        return;
    }
    tilesheet = img;
    projectLoaded = true;
    CONFIG.imgW = img.width;
    CONFIG.imgH = img.height;
    if (data.maps && Array.isArray(data.maps) && data.maps.length > 0) {
        maps = data.maps.map((m) => ({ name: m.name || 'Level', map: m.map.map((row) => [...row]), mapCols: m.mapCols, mapRows: m.mapRows }));
    }
    else if (data.map && Array.isArray(data.map)) {
        const mCols = data.mapCols || CONFIG.mapCols;
        const mRows = data.mapRows || CONFIG.mapRows;
        const legacyMap = [];
        for (let r = 0; r < Math.min(data.map.length, mRows); r++) {
            legacyMap[r] = [];
            for (let c = 0; c < Math.min(data.map[r].length, mCols); c++)
                legacyMap[r][c] = data.map[r][c];
        }
        maps = [{ name: 'Level 1', map: legacyMap, mapCols: mCols, mapRows: mRows }];
    }
    else {
        showToast('Project file has no map data!', 'error');
        return;
    }
    currentMapIndex = 0;
    const entry = getCurrentMapEntry();
    CONFIG.mapCols = entry.mapCols;
    CONFIG.mapRows = entry.mapRows;
    recalcDerived();
    mapCanvas.width = CONFIG.mapW * CONFIG.scale;
    mapCanvas.height = CONFIG.mapH * CONFIG.scale;
    bitsConfig = { bits: data.bits, tileFlags: data.tileFlags };
    ensureBits();
    const maxTiles = getMaxTiles();
    tileFlags = new Array(maxTiles).fill(0);
    for (let i = 0; i < Math.min(data.tileFlags.length, maxTiles); i++)
        tileFlags[i] = data.tileFlags[i];
    currentProjectPath = projectFolder;
    currentProjectName = projectName;
    currentPngFileName = data.pngFileName || 'tilesheet.png';
    const parentFolder = projectFolder.substring(0, projectFolder.lastIndexOf('/'));
    if (parentFolder)
        localStorage.setItem('lastProjectFolder', parentFolder);
    activeBitIndex = 0;
    if (data.convBitplanes !== undefined)
        convBitplanes = data.convBitplanes;
    tileSizeSlider.value = String(gridTileSize);
    tileSizeValue.textContent = String(gridTileSize);
    renderMapTabs();
    renderFlagsUI();
    drawTilesheet();
    drawMap();
    updateActiveDisplay();
    updateProjectUI();
    const hasExport = await editorApi.checkAmigaExport(projectFolder);
    setPreviewEnabled(hasExport);
    showToast('Project loaded: ' + projectName, 'success');
}
// ─── DRAWING ──────────────────────────────────────────────────────────────────
function tileSourceXY(tileIdx) {
    const cols = gridSheetCols();
    const sx = (tileIdx % cols) * gridTileSize;
    const sy = Math.floor(tileIdx / cols) * gridTileSize;
    return { sx, sy };
}
function tileDisplayXY(tileIdx) {
    const base = tileSourceXY(tileIdx);
    return { sx: base.sx * CONFIG.scale, sy: base.sy * CONFIG.scale };
}
function drawMap() {
    const d = gridDTile();
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    if (!projectLoaded || !tilesheet)
        return;
    const curMap = getCurrentMap();
    if (!curMap)
        return;
    const cols = gridMapCols();
    const rows = gridMapRows();
    const sheetCols = gridSheetCols();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tileIdx = curMap[r]?.[c] ?? 0;
            const sx = (tileIdx % sheetCols) * gridTileSize;
            const sy = Math.floor(tileIdx / sheetCols) * gridTileSize;
            mapCtx.drawImage(tilesheet, sx, sy, gridTileSize, gridTileSize, c * d, r * d, d, d);
        }
    }
    drawMapGrid();
    if (bitsOnMapCheckbox.checked)
        drawMapFlagDots();
    drawMapGhost();
}
function drawMapGhost() {
    if (mapHover.col < 0 || mapHover.row < 0)
        return;
    if (!tilesheet)
        return;
    const d = gridDTile();
    const sheetCols = gridSheetCols();
    const sx = (activeTile % sheetCols) * gridTileSize;
    const sy = Math.floor(activeTile / sheetCols) * gridTileSize;
    mapCtx.globalAlpha = 0.5;
    mapCtx.drawImage(tilesheet, sx, sy, gridTileSize, gridTileSize, mapHover.col * d, mapHover.row * d, d, d);
    mapCtx.globalAlpha = 1.0;
    mapCtx.strokeStyle = '#ffd700';
    mapCtx.lineWidth = 2;
    mapCtx.strokeRect(mapHover.col * d + 0.5, mapHover.row * d + 0.5, d - 1, d - 1);
}
function drawMapGrid() {
    mapCtx.strokeStyle = 'rgba(233, 69, 96, 0.35)';
    mapCtx.lineWidth = 1;
    const d = gridDTile();
    for (let x = 0; x <= mapCanvas.width; x += d) {
        mapCtx.beginPath();
        mapCtx.moveTo(x, 0);
        mapCtx.lineTo(x, mapCanvas.height);
        mapCtx.stroke();
    }
    for (let y = 0; y <= mapCanvas.height; y += d) {
        mapCtx.beginPath();
        mapCtx.moveTo(0, y);
        mapCtx.lineTo(mapCanvas.width, y);
        mapCtx.stroke();
    }
}
function drawMapFlagDots() {
    const bits = bitsConfig.bits;
    if (bits.length === 0)
        return;
    const d = gridDTile();
    const dotR = Math.max(1.5, d * 0.08);
    const pad = dotR + 1;
    const perRow = 4;
    const curMap = getCurrentMap();
    if (!curMap)
        return;
    const cols = gridMapCols();
    const rows = gridMapRows();
    mapCtx.save();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tileIdx = curMap[r]?.[c] ?? 0;
            const mask = tileFlags[tileIdx];
            if (mask === 0)
                continue;
            const cellX = c * d;
            const cellY = r * d;
            let dotIdx = 0;
            for (let b = 0; b < TOTAL_BITS; b++) {
                if (!hasBit(tileIdx, b))
                    continue;
                const rx = dotIdx % perRow;
                const ry = Math.floor(dotIdx / perRow);
                const dx = cellX + pad + rx * dotR * 2.5;
                const dy = cellY + pad + ry * dotR * 2.5;
                mapCtx.fillStyle = bits[b].color;
                mapCtx.beginPath();
                mapCtx.arc(dx, dy, dotR, 0, Math.PI * 2);
                mapCtx.fill();
                mapCtx.strokeStyle = '#000';
                mapCtx.lineWidth = 0.5;
                mapCtx.stroke();
                dotIdx++;
            }
        }
    }
    mapCtx.restore();
}
function drawTilesheet() {
    tilesCtx.clearRect(0, 0, tilesCanvas.width, tilesCanvas.height);
    if (!projectLoaded || !tilesheet)
        return;
    tilesCtx.drawImage(tilesheet, 0, 0, CONFIG.sheetW, CONFIG.sheetH, 0, 0, CONFIG.sheetW * CONFIG.scale, CONFIG.sheetH * CONFIG.scale);
    drawFlagDots();
    drawTilesheetGrid();
    drawSheetHover();
    drawActiveHighlight();
}
function drawFlagDots() {
    const bits = bitsConfig.bits;
    if (bits.length === 0)
        return;
    const d = gridDTile();
    const dotR = Math.max(1.5, d * 0.08);
    const pad = dotR + 1;
    const perRow = 4;
    const cols = gridSheetCols();
    const rows = gridSheetRows();
    const maxTiles = cols * rows;
    tilesCtx.save();
    for (let idx = 0; idx < maxTiles; idx++) {
        const mask = tileFlags[idx];
        if (mask === 0)
            continue;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = col * d;
        const cellY = row * d;
        let dotIdx = 0;
        for (let b = 0; b < TOTAL_BITS; b++) {
            if (!hasBit(idx, b))
                continue;
            const rx = dotIdx % perRow;
            const ry = Math.floor(dotIdx / perRow);
            const dx = cellX + pad + rx * dotR * 2.5;
            const dy = cellY + pad + ry * dotR * 2.5;
            tilesCtx.fillStyle = bits[b].color;
            tilesCtx.beginPath();
            tilesCtx.arc(dx, dy, dotR, 0, Math.PI * 2);
            tilesCtx.fill();
            tilesCtx.strokeStyle = '#000';
            tilesCtx.lineWidth = 0.5;
            tilesCtx.stroke();
            dotIdx++;
        }
    }
    tilesCtx.restore();
}
function drawSheetHover() {
    if (sheetHover.col < 0 || sheetHover.row < 0)
        return;
    const d = gridDTile();
    const sx = sheetHover.col * d;
    const sy = sheetHover.row * d;
    tilesCtx.strokeStyle = '#ffd700';
    tilesCtx.lineWidth = 2;
    tilesCtx.strokeRect(sx + 0.5, sy + 0.5, d - 1, d - 1);
}
function drawTilesheetGrid() {
    const wDivisible = CONFIG.imgW % gridTileSize === 0;
    const hDivisible = CONFIG.imgH % gridTileSize === 0;
    const allEven = wDivisible && hDivisible;
    const gridColor = allEven ? 'rgba(0, 255, 100, 0.7)' : 'rgba(255, 60, 60, 0.7)';
    const gridStep = gridTileSize * CONFIG.scale;
    tilesCtx.strokeStyle = gridColor;
    tilesCtx.lineWidth = 1;
    const dispW = CONFIG.sheetW * CONFIG.scale;
    const dispH = CONFIG.sheetH * CONFIG.scale;
    for (let x = 0; x <= dispW; x += gridStep) {
        tilesCtx.beginPath();
        tilesCtx.moveTo(x, 0);
        tilesCtx.lineTo(x, dispH);
        tilesCtx.stroke();
    }
    for (let y = 0; y <= dispH; y += gridStep) {
        tilesCtx.beginPath();
        tilesCtx.moveTo(0, y);
        tilesCtx.lineTo(dispW, y);
        tilesCtx.stroke();
    }
}
function drawActiveHighlight() {
    const d = gridDTile();
    const cols = gridSheetCols();
    const col = activeTile % cols;
    const row = Math.floor(activeTile / cols);
    const sx = col * d;
    const sy = row * d;
    tilesCtx.strokeStyle = '#e94560';
    tilesCtx.lineWidth = 2.5;
    tilesCtx.strokeRect(sx + 1, sy + 1, d - 2, d - 2);
}
function updateActiveDisplay() {
    const cols = gridSheetCols();
    const col = activeTile % cols;
    const row = Math.floor(activeTile / cols);
    const setNames = [];
    for (let b = 0; b < TOTAL_BITS; b++) {
        if (hasBit(activeTile, b)) {
            const name = bitsConfig.bits[b]?.name || `bit${b}`;
            setNames.push(name);
        }
    }
    const flagStr = setNames.length > 0 ? setNames.join('|') : '-';
    activeTileSpan.textContent = `${activeTile} (${col},${row}) flags:[${flagStr}]`;
}
// ─── Flags UI ─────────────────────────────────────────────────────────────────
function renderFlagsUI() {
    flagsColumn.innerHTML = '';
    for (let i = 0; i < TOTAL_BITS; i++) {
        const bit = bitsConfig.bits[i];
        const isActive = i === activeBitIndex;
        const row = document.createElement('div');
        row.className = 'flag-row' + (isActive ? ' active' : '');
        if (!bit.name)
            row.classList.add('unused');
        row.dataset.bitIndex = String(i);
        const numSpan = document.createElement('span');
        numSpan.className = 'flag-bit-num';
        numSpan.textContent = String(i);
        row.appendChild(numSpan);
        const colorWrap = document.createElement('label');
        colorWrap.className = 'flag-color';
        colorWrap.style.backgroundColor = bit.color;
        colorWrap.title = `Bit ${i} color`;
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = bit.color;
        colorInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            bitsConfig.bits[i].color = newColor;
            colorWrap.style.backgroundColor = newColor;
            drawTilesheet();
            drawMap();
        });
        colorInput.addEventListener('click', (e) => e.stopPropagation());
        colorWrap.appendChild(colorInput);
        row.appendChild(colorWrap);
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'flag-name';
        nameInput.value = bit.name;
        nameInput.placeholder = `bit ${i}`;
        nameInput.maxLength = 30;
        nameInput.addEventListener('input', () => {
            bitsConfig.bits[i].name = nameInput.value;
            drawTilesheet();
            drawMap();
            updateActiveDisplay();
            if (nameInput.value)
                row.classList.remove('unused');
            else
                row.classList.add('unused');
        });
        nameInput.addEventListener('click', (e) => e.stopPropagation());
        row.appendChild(nameInput);
        row.addEventListener('click', () => { activeBitIndex = i; renderFlagsUI(); });
        flagsColumn.appendChild(row);
    }
}
// ─── Tile index helpers ───────────────────────────────────────────────────────
function tileIndexFromCoord(col, row) {
    return row * gridSheetCols() + col;
}
function canvasCoords(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
function cellFromPoint(p) {
    return { col: Math.floor(p.x / CONFIG.dTile), row: Math.floor(p.y / CONFIG.dTile) };
}
function isCellInBounds(coord, cols, rows) {
    return coord.col >= 0 && coord.col < cols && coord.row >= 0 && coord.row < rows;
}
function placeTileOnMap(p) {
    const curMap = getCurrentMap();
    if (!curMap)
        return;
    const cell = mapCellFromPoint(p);
    const cols = gridMapCols();
    const rows = gridMapRows();
    if (cell.col < 0 || cell.col >= cols || cell.row < 0 || cell.row >= rows)
        return;
    const key = `${cell.row},${cell.col}`;
    if (key === lastPlaced)
        return;
    lastPlaced = key;
    curMap[cell.row][cell.col] = activeTile;
    drawMap();
}
// ─── Event handlers ───────────────────────────────────────────────────────────
tilesCanvas.addEventListener('mousedown', (e) => {
    const p = canvasCoords(e, tilesCanvas);
    const d = gridDTile();
    const col = Math.floor(p.x / d);
    const row = Math.floor(p.y / d);
    const cols = gridSheetCols();
    const rows = gridSheetRows();
    if (col < 0 || col >= cols || row < 0 || row >= rows)
        return;
    if (e.button === 0) {
        activeTile = row * cols + col;
        updateActiveDisplay();
        drawTilesheet();
    }
    else if (e.button === 2) {
        const idx = row * cols + col;
        toggleBit(idx, activeBitIndex);
        updateActiveDisplay();
        drawTilesheet();
        drawMap();
    }
});
tilesCanvas.addEventListener('mousemove', (e) => {
    const p = canvasCoords(e, tilesCanvas);
    const d = gridDTile();
    const col = Math.floor(p.x / d);
    const row = Math.floor(p.y / d);
    const cols = gridSheetCols();
    const rows = gridSheetRows();
    sheetHover = (col >= 0 && col < cols && row >= 0 && row < rows) ? { col, row } : { col: -1, row: -1 };
    drawTilesheet();
});
tilesCanvas.addEventListener('mouseleave', () => { sheetHover = { col: -1, row: -1 }; drawTilesheet(); });
mapCanvas.addEventListener('mousedown', (e) => { mouseDown = true; lastPlaced = null; placeTileOnMap(canvasCoords(e, mapCanvas)); });
window.addEventListener('mouseup', () => { mouseDown = false; lastPlaced = null; });
mapCanvas.addEventListener('mousemove', (e) => {
    const p = canvasCoords(e, mapCanvas);
    const cell = mapCellFromPoint(p);
    const cols = gridMapCols();
    const rows = gridMapRows();
    mapHover = (cell.col >= 0 && cell.col < cols && cell.row >= 0 && cell.row < rows) ? cell : { col: -1, row: -1 };
    if (mouseDown)
        placeTileOnMap(p);
    else
        drawMap();
});
mapCanvas.addEventListener('mouseleave', () => { mapHover = { col: -1, row: -1 }; drawMap(); });
[mapCanvas, tilesCanvas].forEach(c => c.addEventListener('contextmenu', (e) => e.preventDefault()));
// ─── TILE SIZE SLIDER ─────────────────────────────────────────────────────────
tileSizeSlider.addEventListener('input', () => {
    if (!projectLoaded || !tilesheet)
        return;
    const newTileSize = parseInt(tileSizeSlider.value);
    if (newTileSize === gridTileSize)
        return;
    gridTileSize = newTileSize;
    tileSizeValue.textContent = String(newTileSize);
    drawTilesheet();
    drawMap();
});
// ─── IFF building helpers ─────────────────────────────────────────────────────
function putU16BE(buf, offset, value) {
    buf[offset] = (value >> 8) & 0xFF;
    buf[offset + 1] = value & 0xFF;
}
function putU32BE(buf, offset, value) {
    buf[offset] = (value >> 24) & 0xFF;
    buf[offset + 1] = (value >> 16) & 0xFF;
    buf[offset + 2] = (value >> 8) & 0xFF;
    buf[offset + 3] = value & 0xFF;
}
function buildIffTilesheet() {
    if (!tilesheet)
        throw new Error('No tilesheet loaded');
    const w = CONFIG.imgW;
    const h = CONFIG.imgH;
    const nPlanes = convBitplanes;
    const maxColors = 1 << nPlanes;
    const bytesPerRow = ((w + 15) >> 4) << 1;
    // Get pixel data from the tilesheet image
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(tilesheet, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const rgb = imageData.data;
    // Color-quantize to palette
    const quant = frequencyQuantize(rgb, maxColors);
    const palette = quant.palette;
    const indexMap = quant.indexMap;
    // Build multi-bitplane body (interleaved: plane-by-plane per row)
    const body = new Uint8Array(h * nPlanes * bytesPerRow);
    for (let y = 0; y < h; y++) {
        for (let plane = 0; plane < nPlanes; plane++) {
            const planeRowOff = (y * nPlanes + plane) * bytesPerRow;
            for (let x = 0; x < w; x++) {
                const idx = indexMap[y * w + x];
                if (idx & (1 << plane)) {
                    const byteIdx = x >> 3;
                    const bitIdx = 7 - (x & 7);
                    body[planeRowOff + byteIdx] |= (1 << bitIdx);
                }
            }
        }
    }
    // Build CMAP chunk
    const cmapLen = maxColors * 3;
    const cmap = new Uint8Array(cmapLen);
    cmap.set(palette);
    function iffChunk(type, data) {
        // IFF chunks must be padded to an even length; the size field excludes the pad byte.
        const padded = data.length + (data.length & 1);
        const out = new Uint8Array(8 + padded);
        for (let i = 0; i < 4; i++)
            out[i] = type.charCodeAt(i);
        putU32BE(out, 4, data.length);
        out.set(data, 8);
        return out;
    }
    const bmhd = new Uint8Array(20);
    putU16BE(bmhd, 0, w);
    putU16BE(bmhd, 2, h);
    putU16BE(bmhd, 4, 0);
    putU16BE(bmhd, 6, 0);
    bmhd[8] = nPlanes;
    bmhd[9] = 0;
    bmhd[10] = 0;
    bmhd[11] = 0;
    putU16BE(bmhd, 12, 0);
    bmhd[14] = 44;
    bmhd[15] = 52;
    putU16BE(bmhd, 16, w);
    putU16BE(bmhd, 18, h);
    const bmhdChunk = iffChunk('BMHD', bmhd);
    const cmapChunk = iffChunk('CMAP', cmap);
    const bodyChunk = iffChunk('BODY', body);
    const ilbmInner = new Uint8Array(4 + bmhdChunk.length + cmapChunk.length + bodyChunk.length);
    let p = 0;
    ilbmInner.set([0x49, 0x4C, 0x42, 0x4D], p);
    p += 4;
    ilbmInner.set(bmhdChunk, p);
    p += bmhdChunk.length;
    ilbmInner.set(cmapChunk, p);
    p += cmapChunk.length;
    ilbmInner.set(bodyChunk, p);
    const form = new Uint8Array(8 + ilbmInner.length);
    form.set([0x46, 0x4F, 0x52, 0x4D], 0);
    putU32BE(form, 4, ilbmInner.length);
    form.set(ilbmInner, 8);
    return form;
}
// ─── Static AmiBlitz3 source files ──────────────────────────────────────────
const PLAYER_AB3 = String.raw `; player.ab3
; Speler struct, physics-routines en hulpfuncties voor AmiBlitz3
;
; Importeer via XINCLUDE "player.ab3" in game.ab3.

; --------------------------------------------------------
; Constanten (alleen integer-waarden toegestaan)
; --------------------------------------------------------
#JUMP_FORCE = 4
#MAX_FALL   = 8

; --------------------------------------------------------
; Player NewType (struct)
; --------------------------------------------------------
NEWTYPE .PLAYER
  x.w
  y.w
  speedX.q
  speedY.q
  gravity.q
  isJumping.b
  isFalling.b
  isOnGround.b
End NEWTYPE

; Globale player variabele
player.PLAYER

; --------------------------------------------------------
; InitPlayer{startX, startY}
; --------------------------------------------------------
Statement InitPlayer{startX.w, startY.w}
  Shared player
  player\x          = startX
  player\y          = startY
  player\speedX     = 0
  player\speedY     = 0
  player\gravity    = 0.3
  player\isJumping  = 0
  player\isFalling  = 0
  player\isOnGround = 1
End Statement

; --------------------------------------------------------
; PlayerJump{}
; --------------------------------------------------------
Statement PlayerJump{}
  Shared player
  If player\isOnGround = 1
    player\speedY     = -#JUMP_FORCE
    player\isJumping  = 1
    player\isOnGround = 0
    player\isFalling  = 0
  End If
End Statement

; --------------------------------------------------------
; UpdatePlayer{groundY}
; --------------------------------------------------------
Statement UpdatePlayer{groundY.w}
  Shared player
  If player\isOnGround = 0
    player\speedY = player\speedY + player\gravity
    If player\speedY > #MAX_FALL
      player\speedY = #MAX_FALL
    End If
  End If
  player\x = player\x + player\speedX
  player\y = player\y + player\speedY
  If player\y >= groundY
    player\y          = groundY
    player\speedY     = 0
    player\isJumping  = 0
    player\isFalling  = 0
    player\isOnGround = 1
  End If
  If player\speedY > 0
    If player\isOnGround = 0
      player\isFalling = 1
    End If
  Else
    player\isFalling = 0
  End If
End Statement

; --------------------------------------------------------
; SetPlayerSpeedX{spd}
;   Stel horizontale snelheid in.
; --------------------------------------------------------
Statement SetPlayerSpeedX{spd.w}
  Shared player
  player\speedX = spd
End Statement

; --------------------------------------------------------
; DrawPlayer{color, tileSize}
;   Teken de speler als gevuld blok op BitMap 1.
; --------------------------------------------------------
Statement DrawPlayer{color.w, tileSize.w}
  Shared player
  Use BitMap 1
  Boxf player\x, player\y, player\x + tileSize - 1, player\y + tileSize - 1, color
End Statement
`;
function buildMapsAb3() {
    const mCols = gridMapCols();
    const mRows = gridMapRows();
    const cells = mCols * mRows;
    const numMaps = Math.max(1, maps.length);
    const imgW = CONFIG.imgW;
    const imgH = CONFIG.imgH;
    const ts = gridTileSize;
    const sheetCols = gridSheetCols();
    const maxTiles = getMaxTiles();
    const bp = convBitplanes;
    const bitComments = bitsConfig.bits.map((b, i) => `;   Bit ${i}: ${b.name || '(unused)'}`).join('\n');
    const mapComments = maps.length
        ? maps.map((m, i) => `;   Map ${i}: ${m.name || '(unnamed)'}`).join('\n')
        : ';   Map 0: (unnamed)';
    const toSignedWord = (v) => {
        const u = v & 0xFFFF;
        return u >= 0x8000 ? u - 0x10000 : u;
    };
    const allGridVals = [];
    for (let m = 0; m < numMaps; m++) {
        const map = maps[m]?.map ?? [];
        for (let r = 0; r < mRows; r++) {
            for (let c = 0; c < mCols; c++) {
                allGridVals.push(map[r]?.[c] ?? 0);
            }
        }
    }
    const gridDataLines = [];
    for (let i = 0; i < allGridVals.length; i += 16) {
        gridDataLines.push(`Data.w ${allGridVals.slice(i, i + 16).join(',')}`);
    }
    const flagVals = [];
    for (let i = 0; i < maxTiles; i++)
        flagVals.push(toSignedWord(tileFlags[i] ?? 0));
    const flagChunks = [];
    for (let i = 0; i < maxTiles; i += 16) {
        flagChunks.push(`Data.w ${flagVals.slice(i, i + 16).join(',')}`);
    }
    return `; ---------------------------------------------------------------
; maps.ab3 -- Gegenereerd door RetroMapEditor
; Map data, afmetingen en teken-routines
; ---------------------------------------------------------------
; Maps:
${mapComments}
;
; Tile vlag bits:
${bitComments}
; ---------------------------------------------------------------

#MAP_COLS   = ${mCols}
#MAP_ROWS   = ${mRows}
#NUM_MAPS   = ${numMaps}
#TILE_SIZE  = ${ts}
#SHEET_COLS = ${sheetCols}
#MAX_TILES  = ${maxTiles}
#SHEET_W    = ${imgW}
#SHEET_H    = ${imgH}
#BITPLANES  = ${bp}

Dim tilemap.w(${numMaps * cells})
Dim tileFlags.w(${maxTiles})

; ---------------------------------------------------------------
; LoadMaps{}
;   Lees alle map-data en tile-vlaggen vanuit de Data-labels.
; ---------------------------------------------------------------
Statement LoadMaps{}
  Shared tilemap, tileFlags
  Restore MapData
  For i = 0 To ${numMaps * cells - 1}
    Read tmp.w
    tilemap(i) = tmp
  Next i
  Restore FlagData
  For i = 0 To ${maxTiles - 1}
    Read tmp.w
    tileFlags(i) = tmp
  Next i
End Statement

; ---------------------------------------------------------------
; DrawMap{mapIndex}
;   Teken de opgegeven map naar BitMap 1.
;   Vereist: BitMap 0 = tilesheet, BitMap 1 = doelscherm.
; ---------------------------------------------------------------
Statement DrawMap{mapIndex.w}
  Shared tilemap
  mapBase = mapIndex * ${cells}
  For y = 0 To #MAP_ROWS - 1
    For x = 0 To #MAP_COLS - 1
      idx    = mapBase + y * #MAP_COLS + x
      tile.w = tilemap(idx)
      srcX.w = (tile MOD #SHEET_COLS) * #TILE_SIZE
      srcY.w = tile / #SHEET_COLS
      srcY   = srcY * #TILE_SIZE
      dstX   = x * #TILE_SIZE
      dstY   = y * #TILE_SIZE
      Use BitMap 0
      GetaShape 0, srcX, srcY, #TILE_SIZE, #TILE_SIZE
      Use BitMap 1
      Blit 0, dstX, dstY
    Next x
  Next y
End Statement

; ---------------------------------------------------------------
; Map data (gegenereerd)
; ---------------------------------------------------------------
.MapData:
${gridDataLines.join('\n')}

.FlagData:
${flagChunks.join('\n')}
`;
}
function buildGameAb3() {
    const mCols = gridMapCols();
    const mRows = gridMapRows();
    const ts = gridTileSize;
    const bp = convBitplanes;
    const imgW = CONFIG.imgW;
    const imgH = CONFIG.imgH;
    const mapW = mCols * ts;
    const mapH = mRows * ts;
    const groundY = mapH - ts;
    return `; ---------------------------------------------------------------
; game.ab3 -- Gegenereerd door RetroMapEditor
; Hoofdprogramma: setup, input en gameloop
;
; Vereiste bestanden (in dezelfde AmigaDOS drawer):
;   tiles.iff  - tilesheet (IFF/ILBM)
;   maps.ab3   - map data (gegenereerd door RetroMapEditor)
;   player.ab3 - speler struct en physics
; ---------------------------------------------------------------

XINCLUDE "player.ab3"
XINCLUDE "maps.ab3"

; ---------------------------------------------------------------
; Setup (LoadBitMap vereist Amiga mode, dus voor BLITZ)
; ---------------------------------------------------------------
BitMap 0, ${imgW}, ${imgH}, ${bp}
BitMap 1, ${mapW}, ${mapH}, ${bp}

LoadBitMap 0, "tiles.iff", 0
VWait 100

BLITZ
Slice 0, 44, ${bp}
Use BitMap 0
Use Palette 0
Show 1

; ---------------------------------------------------------------
; Map laden en speler initialiseren
; ---------------------------------------------------------------
LoadMaps{}
InitPlayer{16, 16}
DrawMap{0}

groundY.w = ${groundY}

; ---------------------------------------------------------------
; Game loop (ESC om te stoppen)
; ---------------------------------------------------------------
Repeat
  VWait

  ; Joystick-input (poort 1)
  joy = Joy(1)
  If joy AND 4
    SetPlayerSpeedX{-2}
  ElseIf joy AND 8
    SetPlayerSpeedX{2}
  Else
    SetPlayerSpeedX{0}
  End If

  If Fire(1) Then PlayerJump{}

  UpdatePlayer{groundY}

  DrawMap{0}
  DrawPlayer{1, ${ts}}

  Show 1
Until RawStatus($45)

End
`;
}
function stringToAmigaBytes(str) {
    // Normalize to AmigaDOS LF line endings and strip anything the Amiga
    // (ISO 8859-1 / plain ASCII source) cannot represent. Non-printable and
    // non-ASCII characters are replaced with '?' so generated .ab3 sources stay clean.
    const clean = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const buf = new Uint8Array(clean.length);
    for (let i = 0; i < clean.length; i++) {
        const code = clean.charCodeAt(i);
        if (code === 0x0A)
            buf[i] = 0x0A; // keep LF line endings
        else if (code >= 0x20 && code <= 0x7E)
            buf[i] = code; // printable ASCII
        else
            buf[i] = 0x3F; // '?' for control / non-ASCII
    }
    return buf;
}
// ─── Amiga export preview & export ────────────────────────────────────────────
let cachedPreviewIff = null;
let cachedMapsAb3Bytes = null;
let cachedGameAb3Bytes = null;
let cachedPlayerAb3Bytes = null;
let hasExportData = false;
const previewBtn = document.getElementById('tab-level-editor');
function setPreviewEnabled(enabled) {
    hasExportData = enabled;
}
function showAmigaPreview() {
    if (!projectLoaded || !tilesheet || !currentProjectPath) {
        showToast('No project loaded', 'error');
        return;
    }
    cachedPreviewIff = buildIffTilesheet();
    const mapsAb3raw = buildMapsAb3();
    cachedMapsAb3Bytes = stringToAmigaBytes(mapsAb3raw);
    const gameAb3raw = buildGameAb3();
    cachedGameAb3Bytes = stringToAmigaBytes(gameAb3raw);
    cachedPlayerAb3Bytes = stringToAmigaBytes(PLAYER_AB3);
    const imgW = CONFIG.imgW;
    const imgH = CONFIG.imgH;
    document.getElementById('iff-info').textContent = `${imgW}\u00d7${imgH} px, ${formatSize(cachedPreviewIff.length)}`;
    document.getElementById('map-info').textContent = `maps.ab3 ${formatSize(cachedMapsAb3Bytes.length)}`;
    const iffCanvas = document.getElementById('iff-preview-canvas');
    const maxDim = 240;
    const scale = Math.min(maxDim / imgW, maxDim / imgH, 1);
    iffCanvas.width = Math.round(imgW * scale);
    iffCanvas.height = Math.round(imgH * scale);
    const iffCtx = iffCanvas.getContext('2d');
    iffCtx.imageSmoothingEnabled = false;
    iffCtx.drawImage(tilesheet, 0, 0, iffCanvas.width, iffCanvas.height);
    document.getElementById('ab3-preview').value = mapsAb3raw;
    document.getElementById('ab3-bin-preview').value = gameAb3raw;
    document.getElementById('ab3-player-preview').value = PLAYER_AB3;
    document.getElementById('amiga-preview-overlay').classList.remove('hidden');
}
function formatSize(bytes) { return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'; }
async function doExportAmiga() {
    if (!cachedPreviewIff || !cachedMapsAb3Bytes || !cachedGameAb3Bytes || !cachedPlayerAb3Bytes) {
        showToast('Nothing to export', 'error');
        return;
    }
    const success = await editorApi.exportAmiga({
        projectFolder: currentProjectPath,
        iffData: Array.from(cachedPreviewIff),
        mapsAb3Data: Array.from(cachedMapsAb3Bytes),
        gameAb3Data: Array.from(cachedGameAb3Bytes),
        playerAb3Data: Array.from(cachedPlayerAb3Bytes)
    });
    if (success) {
        setPreviewEnabled(true);
        showToast('Exported to amiga', 'success');
        document.getElementById('amiga-preview-overlay').classList.add('hidden');
    }
    else
        showToast('Export failed', 'error');
}
// ─── Bits-on-map toggle ────────────────────────────────────────────────────
bitsOnMapCheckbox.addEventListener('change', () => {
    localStorage.setItem('bitsOnMap', bitsOnMapCheckbox.checked ? '1' : '0');
    drawMap();
});
// ─── Modal event handlers ──────────────────────────────────────────────────
let pickedPngDataUrl = null;
let pickedPngFileName = '';
let pickedFolderPath = null;
let modalIffBytes = null;
let modalBp = 4;
let pickedImgWidth = 320;
let pickedImgHeight = 256;
const modalBpSlider = document.getElementById('modal-bitplanes');
const modalBpLabel = document.getElementById('modal-bp-label');
const modalColorsLabel = document.getElementById('modal-colors-label');
const modalIffPreviewRow = document.getElementById('modal-iff-preview-row');
const modalPngPreviewCanvas = document.getElementById('modal-png-preview-canvas');
const modalIffPreviewCanvas = document.getElementById('modal-iff-preview-canvas');
modalBpSlider.addEventListener('input', () => {
    modalBp = parseInt(modalBpSlider.value);
    const colors = 1 << modalBp;
    modalBpLabel.textContent = String(modalBp);
    modalColorsLabel.textContent = `${colors} color${modalBp !== 1 ? 's' : ''}`;
    if (pickedPngDataUrl)
        updateModalIffPreview();
});
function updateModalIffPreview() {
    if (!pickedPngDataUrl)
        return;
    const img = new Image();
    img.onload = () => {
        const result = pngToIffMulti(img, modalBp);
        modalIffBytes = result.iff;
        const { palette, indexMap } = result;
        const w = img.width;
        const h = img.height;
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext('2d');
        const imageData = tctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
            const idx = indexMap[i];
            const colOff = idx * 3;
            const pxOff = i * 4;
            imageData.data[pxOff] = palette[colOff];
            imageData.data[pxOff + 1] = palette[colOff + 1];
            imageData.data[pxOff + 2] = palette[colOff + 2];
            imageData.data[pxOff + 3] = 255;
        }
        tctx.putImageData(imageData, 0, 0);
        const maxDim = 200;
        const scale = Math.min(maxDim / w, maxDim / h, 1);
        const dw = Math.round(w * scale);
        const dh = Math.round(h * scale);
        modalIffPreviewCanvas.width = dw;
        modalIffPreviewCanvas.height = dh;
        const ctx = modalIffPreviewCanvas.getContext('2d');
        ctx.clearRect(0, 0, dw, dh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, w, h, 0, 0, dw, dh);
        modalIffPreviewCanvas.style.display = 'block';
        modalPngPreviewCanvas.width = dw;
        modalPngPreviewCanvas.height = dh;
        const pngCtx = modalPngPreviewCanvas.getContext('2d');
        pngCtx.clearRect(0, 0, dw, dh);
        pngCtx.imageSmoothingEnabled = false;
        pngCtx.drawImage(img, 0, 0, w, h, 0, 0, dw, dh);
        modalPngPreviewCanvas.style.display = 'block';
    };
    img.src = pickedPngDataUrl;
}
document.getElementById('btn-pick-folder').addEventListener('click', async () => {
    const saved = localStorage.getItem('lastProjectFolder') || undefined;
    const folder = await editorApi.pickFolder(saved);
    if (folder) {
        pickedFolderPath = folder;
        document.getElementById('folder-path').textContent = folder;
    }
});
document.getElementById('btn-pick-png').addEventListener('click', async () => {
    const result = await editorApi.pickPng();
    if (!result)
        return;
    pickedPngDataUrl = result.dataUrl;
    pickedPngFileName = result.fileName;
    document.getElementById('png-file-name').textContent = result.fileName;
    const img = new Image();
    img.onload = () => {
        pickedImgWidth = img.width;
        pickedImgHeight = img.height;
    };
    img.src = result.dataUrl;
    modalIffPreviewRow.style.display = 'block';
    updateModalIffPreview();
});
document.getElementById('btn-modal-cancel').addEventListener('click', () => document.getElementById('new-project-overlay').classList.add('hidden'));
document.getElementById('btn-rename-cancel').addEventListener('click', () => { renameMapIndex = -1; document.getElementById('rename-map-overlay').classList.add('hidden'); });
document.getElementById('btn-rename-confirm').addEventListener('click', () => finishRenameMap());
document.getElementById('input-rename-map').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')
        finishRenameMap();
    else if (e.key === 'Escape') {
        renameMapIndex = -1;
        document.getElementById('rename-map-overlay').classList.add('hidden');
    }
});
document.getElementById('btn-delete-cancel').addEventListener('click', () => { deleteMapIndex = -1; document.getElementById('delete-map-overlay').classList.add('hidden'); });
document.getElementById('btn-delete-confirm').addEventListener('click', () => confirmDeleteMap());
document.getElementById('btn-modal-create').addEventListener('click', async () => {
    if (!pickedPngDataUrl) {
        const btn = document.getElementById('btn-pick-png');
        btn.style.borderColor = '#e94560';
        setTimeout(() => { btn.style.borderColor = ''; }, 1000);
        return;
    }
    if (!pickedFolderPath) {
        const btn = document.getElementById('btn-pick-folder');
        btn.style.borderColor = '#e94560';
        setTimeout(() => { btn.style.borderColor = ''; }, 1000);
        return;
    }
    const projectName = document.getElementById('input-project-name').value.trim() || 'MyProject';
    const firstMapName = document.getElementById('input-map-name').value.trim() || 'Level 1';
    const tileSize = 16;
    const sheetCols = Math.max(1, Math.floor(pickedImgWidth / tileSize));
    const sheetRows = Math.max(1, Math.floor(pickedImgHeight / tileSize));
    const mapCols = 20; // default Amiga: 320/16=20
    const mapRows = 16; // default Amiga: 256/16=16
    const maxTiles = sheetCols * sheetRows;
    tileFlags = new Array(maxTiles).fill(0);
    document.getElementById('new-project-overlay').classList.add('hidden');
    await createNewProject(projectName, pickedFolderPath, pickedPngDataUrl, pickedPngFileName, sheetCols, sheetRows, mapCols, mapRows, firstMapName, tileSize, pickedImgWidth, pickedImgHeight, modalIffBytes ? Array.from(modalIffBytes) : undefined, modalBp);
});
// ─── Rename project ────────────────────────────────────────────────────────
const projectNameSpan = document.getElementById('project-name');
const projectNameInput = document.getElementById('project-name-input');
projectNameSpan.addEventListener('click', () => {
    if (!projectLoaded)
        return;
    projectNameSpan.classList.add('hidden');
    projectNameInput.value = currentProjectName;
    projectNameInput.classList.remove('hidden');
    projectNameInput.focus();
    projectNameInput.select();
});
function finishRename() {
    const newName = projectNameInput.value.trim();
    if (!newName || !projectLoaded) {
        projectNameInput.classList.add('hidden');
        projectNameSpan.classList.remove('hidden');
        return;
    }
    currentProjectName = newName;
    projectNameInput.classList.add('hidden');
    projectNameSpan.classList.remove('hidden');
    updateProjectUI();
    saveProject();
}
projectNameInput.addEventListener('blur', finishRename);
projectNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')
        finishRename();
    if (e.key === 'Escape') {
        projectNameInput.classList.add('hidden');
        projectNameSpan.classList.remove('hidden');
    }
});
// ─── Custom file browser ──────────────────────────────────────────────────
let fbCurrentPath = '';
let fbSelectedPath = '';
async function fbNavigate(dirPath) {
    fbCurrentPath = dirPath;
    fbSelectedPath = '';
    document.getElementById('btn-fb-open').setAttribute('disabled', 'true');
    const listing = await editorApi.listDirectory(dirPath);
    if (!listing) {
        document.getElementById('fb-list').innerHTML = '<div class="fb-item" style="color:#e94560;cursor:default">Error reading directory</div>';
        return;
    }
    document.getElementById('fb-current-path').textContent = dirPath;
    let html = '';
    if (dirPath !== '/') {
        const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
        html += `<button class="fb-item up" data-path="${parent}"><span class="fb-item-name">..</span></button>`;
    }
    const visibleFolders = listing.folders.filter(f => !f.startsWith('.'));
    for (const f of visibleFolders)
        html += `<button class="fb-item folder" data-path="${dirPath}/${f}"><span class="fb-item-name">${f}</span></button>`;
    const visibleFiles = listing.files.filter(f => !f.startsWith('.'));
    for (const f of visibleFiles) {
        const isProj = f.endsWith('.project');
        html += `<button class="fb-item file${isProj ? '' : ' disabled'}" data-path="${dirPath}/${f}"${isProj ? '' : ' disabled'}><span class="fb-item-name">${f}</span></button>`;
    }
    document.getElementById('fb-list').innerHTML = html;
    document.querySelectorAll('#fb-list .fb-item').forEach(el => {
        el.addEventListener('click', async () => {
            const path = el.dataset.path;
            if (el.classList.contains('folder') || el.classList.contains('up'))
                await fbNavigate(path);
            else {
                document.querySelectorAll('#fb-list .fb-item').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                fbSelectedPath = path;
                document.getElementById('btn-fb-open').removeAttribute('disabled');
            }
        });
        el.addEventListener('dblclick', async () => {
            const path = el.dataset.path;
            if (el.classList.contains('file')) {
                document.getElementById('file-browser-overlay').classList.add('hidden');
                await loadProjectFromPath(path);
            }
        });
    });
}
async function loadProjectFromPath(filePath) {
    const result = await editorApi.loadProjectFile(filePath);
    if (!result) {
        showToast('Failed to load project', 'error');
        return;
    }
    await applyLoadedProject(result);
}
document.getElementById('btn-fb-cancel').addEventListener('click', () => document.getElementById('file-browser-overlay').classList.add('hidden'));
document.getElementById('btn-fb-open').addEventListener('click', async () => {
    if (!fbSelectedPath)
        return;
    document.getElementById('file-browser-overlay').classList.add('hidden');
    await loadProjectFromPath(fbSelectedPath);
});
document.getElementById('btn-preview-cancel').addEventListener('click', () => document.getElementById('amiga-preview-overlay').classList.add('hidden'));
document.getElementById('btn-preview-export').addEventListener('click', () => doExportAmiga());
// Switch between maps.ab3, game.ab3 and player.ab3 source previews.
document.querySelectorAll('.preview-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.ab3tab;
        document.querySelectorAll('.preview-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.getElementById('ab3-preview').classList.toggle('hidden', target !== 'maps');
        document.getElementById('ab3-bin-preview').classList.toggle('hidden', target !== 'game');
        document.getElementById('ab3-player-preview').classList.toggle('hidden', target !== 'player');
    });
});
// ─── TAB SWITCHING ────────────────────────────────────────────────────────
const tabLevelEditor = document.getElementById('tab-level-editor');
const tabPngIff = document.getElementById('tab-png-iff');
const tabTiledViewer = document.getElementById('tab-tiled-viewer');
const contentLevelEditor = document.getElementById('tab-content-level-editor');
const contentPngIff = document.getElementById('tab-content-png-iff');
const contentTiledViewer = document.getElementById('tab-content-tiled-viewer');
function deactivateAllTabs() {
    tabLevelEditor.classList.remove('active');
    tabPngIff.classList.remove('active');
    if (tabTiledViewer)
        tabTiledViewer.classList.remove('active');
    contentLevelEditor.classList.remove('active');
    contentPngIff.classList.remove('active');
    contentTiledViewer.classList.remove('active');
}
function switchTab(tabName) {
    deactivateAllTabs();
    if (tabName === 'png-iff') {
        tabPngIff.classList.add('active');
        contentPngIff.classList.add('active');
    }
    else if (tabName === 'tiled-viewer') {
        tabTiledViewer.classList.add('active');
        contentTiledViewer.classList.add('active');
        initTiledViewerTab();
    }
    else {
        tabLevelEditor.classList.add('active');
        contentLevelEditor.classList.add('active');
    }
}
tabLevelEditor.addEventListener('click', () => switchTab('level-editor'));
tabPngIff.addEventListener('click', () => switchTab('png-iff'));
tabTiledViewer.addEventListener('click', () => switchTab('tiled-viewer'));
// ─── CUSTOM MENU BAR (HTML dropdowns inside the window) ───────────────────
document.querySelectorAll('#menu-bar .menu-item').forEach(el => {
    el.addEventListener('click', () => {
        const action = el.dataset.action;
        handleMenuAction(action);
    });
});
function handleMenuAction(action) {
    switch (action) {
        case 'new':
            switchTab('level-editor');
            document.getElementById('new-project-title').textContent = 'New Project';
            document.getElementById('btn-modal-create').classList.remove('hidden');
            document.getElementById('btn-modal-save-settings').classList.add('hidden');
            pickedPngDataUrl = null;
            pickedPngFileName = '';
            pickedFolderPath = null;
            modalIffBytes = null;
            modalBp = 4;
            modalBpSlider.value = '4';
            modalBpLabel.textContent = '4';
            modalColorsLabel.textContent = '16 colors';
            pickedImgWidth = 320;
            pickedImgHeight = 256;
            modalIffPreviewRow.style.display = 'none';
            document.getElementById('png-file-name').textContent = 'no file selected';
            document.getElementById('folder-path').textContent = 'no folder selected';
            document.getElementById('input-project-name').value = 'MyProject';
            document.getElementById('new-project-overlay').classList.remove('hidden');
            break;
        case 'load':
            switchTab('level-editor');
            showLoadProjectBrowser();
            break;
        case 'save':
            switchTab('level-editor');
            saveProject();
            break;
        case 'settings':
            if (!projectLoaded) {
                showToast('No project loaded', 'error');
                return;
            }
            showProjectSettings();
            break;
        case 'export':
            switchTab('level-editor');
            showAmigaPreview();
            break;
        case 'preview':
            switchTab('level-editor');
            if (hasExportData)
                showAmigaPreview();
            else
                showToast('No export data yet. Export first.', 'error');
            break;
        case 'tab-level-editor':
            switchTab('level-editor');
            break;
        case 'tab-png-iff':
            switchTab('png-iff');
            break;
        case 'tab-tiled-viewer':
            switchTab('tiled-viewer');
            break;
    }
}
function showProjectSettings() {
    switchTab('level-editor');
    const titleEl = document.getElementById('new-project-title');
    titleEl.textContent = 'Project Settings';
    document.getElementById('btn-modal-create').classList.add('hidden');
    document.getElementById('btn-modal-save-settings').classList.remove('hidden');
    document.getElementById('input-project-name').value = currentProjectName;
    modalBp = convBitplanes;
    modalBpSlider.value = String(convBitplanes);
    modalBpLabel.textContent = String(convBitplanes);
    modalColorsLabel.textContent = `${1 << convBitplanes} color${convBitplanes !== 1 ? 's' : ''}`;
    if (tilesheet) {
        pickedPngDataUrl = tilesheet.src;
        pickedPngFileName = currentPngFileName;
        document.getElementById('png-file-name').textContent = currentPngFileName;
        document.getElementById('folder-path').textContent = currentProjectPath;
        pickedImgWidth = CONFIG.imgW;
        pickedImgHeight = CONFIG.imgH;
        modalIffPreviewRow.style.display = 'block';
        updateModalIffPreview();
    }
    document.getElementById('new-project-overlay').classList.remove('hidden');
}
document.getElementById('btn-modal-save-settings').addEventListener('click', async () => {
    const newName = document.getElementById('input-project-name').value.trim() || currentProjectName;
    convBitplanes = modalBp;
    currentProjectName = newName;
    recalcDerived();
    drawTilesheet();
    drawMap();
    updateProjectUI();
    document.getElementById('new-project-overlay').classList.add('hidden');
    saveProject();
    showToast('Settings saved', 'success');
});
async function showLoadProjectBrowser() {
    const saved = localStorage.getItem('lastProjectFolder') || (await editorApi.pickFolder());
    if (!saved)
        return;
    document.getElementById('file-browser-overlay').classList.remove('hidden');
    await fbNavigate(saved);
}
// ─── PNG → IFF CONVERTER (multi-bitplane with color quantization) ─────────
let convPngDataUrl = null;
let convPngFileName = '';
let convIffBytes = null;
let convPalette = null;
let convIndexMap = null;
let convImgWidth = 0;
let convImgHeight = 0;
const btnPickPngConv = document.getElementById('btn-pick-png-conv');
const pngFileNameConv = document.getElementById('png-file-name-conv');
const convPngCanvas = document.getElementById('conv-png-canvas');
const convIffCanvas = document.getElementById('conv-iff-canvas');
const convPreviewRow = document.getElementById('conv-png-preview-row');
const convFileInfo = document.getElementById('conv-file-info');
const convPngDim = document.getElementById('conv-png-dim');
const convIffSize = document.getElementById('conv-iff-size');
const convIffColors = document.getElementById('conv-iff-colors');
const convBpSlider = document.getElementById('conv-bitplanes');
const convBpLabel = document.getElementById('conv-bp-label');
const convColorsLabel = document.getElementById('conv-colors-label');
const convPaletteDiv = document.getElementById('conv-palette');
const convPaletteSwatches = document.getElementById('conv-palette-swatches');
const btnConvertIff = document.getElementById('btn-convert-iff');
let convLoadedImg = null;
convBpSlider.addEventListener('input', () => {
    convBitplanes = parseInt(convBpSlider.value);
    const colors = 1 << convBitplanes;
    convBpLabel.textContent = String(convBitplanes);
    convColorsLabel.textContent = `${colors} color${convBitplanes !== 1 ? 's' : ''}`;
    if (convLoadedImg)
        reconvert();
});
btnPickPngConv.addEventListener('click', async () => {
    const result = await editorApi.pickPng();
    if (!result)
        return;
    convPngDataUrl = result.dataUrl;
    convPngFileName = result.fileName;
    pngFileNameConv.textContent = result.fileName;
    const img = new Image();
    img.onload = () => {
        convLoadedImg = img;
        convPngCanvas.width = img.width;
        convPngCanvas.height = img.height;
        const ctx = convPngCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        convPngDim.textContent = `${img.width}×${img.height} px`;
        convImgWidth = img.width;
        convImgHeight = img.height;
        reconvert();
        convPreviewRow.style.display = 'flex';
        convFileInfo.style.display = 'flex';
        btnConvertIff.disabled = false;
    };
    img.src = result.dataUrl;
});
function reconvert() {
    if (!convLoadedImg)
        return;
    const bp = parseInt(convBpSlider.value);
    const result = pngToIffMulti(convLoadedImg, bp);
    convIffBytes = result.iff;
    convPalette = result.palette;
    convIndexMap = result.indexMap;
    drawIffPreview(convPalette, convIndexMap);
    drawPaletteSwatches(convPalette, bp);
    convIffSize.textContent = formatSize(convIffBytes.length);
    convIffColors.textContent = `${1 << bp} colors`;
    convPaletteDiv.style.display = 'block';
}
function drawIffPreview(palette, indexMap) {
    const w = convImgWidth;
    const h = convImgHeight;
    convIffCanvas.width = w;
    convIffCanvas.height = h;
    const iffCtx = convIffCanvas.getContext('2d');
    iffCtx.imageSmoothingEnabled = false;
    const imageData = iffCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = indexMap[y * w + x];
            const colOff = idx * 3;
            const pxOff = (y * w + x) * 4;
            imageData.data[pxOff] = palette[colOff];
            imageData.data[pxOff + 1] = palette[colOff + 1];
            imageData.data[pxOff + 2] = palette[colOff + 2];
            imageData.data[pxOff + 3] = 255;
        }
    }
    iffCtx.putImageData(imageData, 0, 0);
}
function drawPaletteSwatches(palette, nPlanes) {
    const numColors = 1 << nPlanes;
    let html = '';
    for (let i = 0; i < numColors; i++) {
        const off = i * 3;
        const r = palette[off];
        const g = palette[off + 1];
        const b = palette[off + 2];
        html += `<span class="conv-swatch" style="background:rgb(${r},${g},${b})" title="#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}"></span>`;
    }
    convPaletteSwatches.innerHTML = html;
}
function frequencyQuantize(rgb, maxColors) {
    const numPixels = rgb.length / 4;
    if (numPixels === 0 || maxColors === 0) {
        return { palette: new Uint8Array(0), indexMap: new Uint8Array(0) };
    }
    const colorFreq = new Map();
    const colorRGB = new Map();
    for (let i = 0; i < numPixels; i++) {
        const off = i * 4;
        const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
        const key = (r << 16) | (g << 8) | b;
        colorFreq.set(key, (colorFreq.get(key) || 0) + 1);
        if (!colorRGB.has(key))
            colorRGB.set(key, [r, g, b]);
    }
    const sorted = [...colorFreq.entries()].sort((a, b) => b[1] - a[1]);
    const paletteSize = Math.min(sorted.length, maxColors);
    const topColors = sorted.slice(0, paletteSize);
    const colorToIndex = new Map();
    const palette = new Uint8Array(paletteSize * 3);
    for (let i = 0; i < paletteSize; i++) {
        const key = topColors[i][0];
        const [r1, g1, b1] = colorRGB.get(key);
        palette[i * 3] = r1;
        palette[i * 3 + 1] = g1;
        palette[i * 3 + 2] = b1;
        colorToIndex.set(key, i);
    }
    const indexMap = new Uint8Array(numPixels);
    for (let i = 0; i < numPixels; i++) {
        const off = i * 4;
        const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
        const key = (r << 16) | (g << 8) | b;
        const exact = colorToIndex.get(key);
        if (exact !== undefined) {
            indexMap[i] = exact;
            continue;
        }
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let c = 0; c < paletteSize; c++) {
            const pr = palette[c * 3], pg = palette[c * 3 + 1], pb = palette[c * 3 + 2];
            const dr = r - pr, dg = g - pg, db = b - pb;
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = c;
            }
        }
        indexMap[i] = bestIdx;
    }
    return { palette, indexMap };
}
function pngToIffMulti(img, nPlanes) {
    const w = img.width;
    const h = img.height;
    const bytesPerRow = ((w + 15) >> 4) << 1;
    const maxColors = 1 << nPlanes;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const rgb = imageData.data;
    const quant = frequencyQuantize(rgb, maxColors);
    const palette = quant.palette;
    const indexMap = quant.indexMap;
    const body = new Uint8Array(h * nPlanes * bytesPerRow);
    for (let y = 0; y < h; y++) {
        for (let plane = 0; plane < nPlanes; plane++) {
            const planeRowOff = (y * nPlanes + plane) * bytesPerRow;
            for (let x = 0; x < w; x++) {
                const idx = indexMap[y * w + x];
                if (idx & (1 << plane)) {
                    const byteIdx = x >> 3;
                    const bitIdx = 7 - (x & 7);
                    body[planeRowOff + byteIdx] |= (1 << bitIdx);
                }
            }
        }
    }
    const cmapLen = maxColors * 3;
    const cmap = new Uint8Array(cmapLen);
    cmap.set(palette);
    function iffChunk(type, data) {
        // IFF chunks must be padded to an even length; the size field excludes the pad byte.
        const padded = data.length + (data.length & 1);
        const out = new Uint8Array(8 + padded);
        for (let i = 0; i < 4; i++)
            out[i] = type.charCodeAt(i);
        putU32BE(out, 4, data.length);
        out.set(data, 8);
        return out;
    }
    const bmhd = new Uint8Array(20);
    putU16BE(bmhd, 0, w);
    putU16BE(bmhd, 2, h);
    putU16BE(bmhd, 4, 0);
    putU16BE(bmhd, 6, 0);
    bmhd[8] = nPlanes;
    bmhd[9] = 0;
    bmhd[10] = 0;
    bmhd[11] = 0;
    putU16BE(bmhd, 12, 0);
    bmhd[14] = 44;
    bmhd[15] = 52;
    putU16BE(bmhd, 16, w);
    putU16BE(bmhd, 18, h);
    const bmhdChunk = iffChunk('BMHD', bmhd);
    const cmapChunk = iffChunk('CMAP', cmap);
    const bodyChunk = iffChunk('BODY', body);
    const ilbmInner = new Uint8Array(4 + bmhdChunk.length + cmapChunk.length + bodyChunk.length);
    let p = 0;
    ilbmInner.set([0x49, 0x4C, 0x42, 0x4D], p);
    p += 4;
    ilbmInner.set(bmhdChunk, p);
    p += bmhdChunk.length;
    ilbmInner.set(cmapChunk, p);
    p += cmapChunk.length;
    ilbmInner.set(bodyChunk, p);
    const form = new Uint8Array(8 + ilbmInner.length);
    form.set([0x46, 0x4F, 0x52, 0x4D], 0);
    putU32BE(form, 4, ilbmInner.length);
    form.set(ilbmInner, 8);
    return { iff: form, palette, indexMap };
}
btnConvertIff.addEventListener('click', async () => {
    if (!convIffBytes)
        return;
    const defaultName = convPngFileName.replace(/\.png$/i, '.iff');
    const filePath = await editorApi.saveIffDialog(defaultName);
    if (!filePath)
        return;
    const success = await editorApi.writeFile(filePath, Array.from(convIffBytes));
    if (success)
        showToast('IFF saved: ' + filePath, 'success');
    else
        showToast('Failed to save IFF', 'error');
});
// ─── TILED VIEWER TAB (Google's suggested approach) ───────────────────────
let tiledViewerInitialized = false;
async function initTiledViewerTab() {
    if (tiledViewerInitialized)
        return;
    tiledViewerInitialized = true;
    const browseBtn = document.getElementById('tiled-browse');
    const pathEl = document.getElementById('tiled-path');
    const fileEl = document.getElementById('tiled-filename');
    const mapsEl = document.getElementById('tiled-maps');
    const canvas = document.getElementById('tiled-canvas');
    const zoomInBtn = document.getElementById('tiled-zoom-in');
    const zoomOutBtn = document.getElementById('tiled-zoom-out');
    const canvasWrap = document.getElementById('tiled-canvas-wrap');
    let currentZoom = 3;
    // Zoom buttons
    if (zoomInBtn)
        zoomInBtn.addEventListener('click', () => {
            currentZoom = Math.min(4, currentZoom + 0.25);
            window.tiledSetZoom?.(currentZoom);
        });
    if (zoomOutBtn)
        zoomOutBtn.addEventListener('click', () => {
            currentZoom = Math.max(0.1, currentZoom - 0.25);
            window.tiledSetZoom?.(currentZoom);
        });
    // Mouse wheel zoom
    if (canvasWrap)
        canvasWrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            currentZoom = Math.max(0.1, Math.min(4, currentZoom + (e.deltaY > 0 ? -0.1 : 0.1)));
            window.tiledSetZoom?.(currentZoom);
        });
    if (!browseBtn || !canvas)
        return;
    let currentFolder = '';
    let mapList = [];
    let currentMapIdx = -1;
    let pngPath = '';
    browseBtn.addEventListener('click', async () => {
        const folder = await editorApi.pickFolder();
        if (!folder)
            return;
        currentFolder = folder;
        pathEl.textContent = folder;
        const list = await editorApi.listDirectory(folder);
        if (!list)
            return;
        const jsonFiles = list.files.filter((f) => f.toLowerCase().endsWith('.json'));
        const pngFiles = list.files.filter((f) => f.toLowerCase().endsWith('.png'));
        if (jsonFiles.length === 0) {
            pathEl.textContent = folder + ' (no .json files found)';
            return;
        }
        mapList = jsonFiles.map((f) => ({
            name: f,
            jsonPath: folder + '/' + f,
        }));
        // Find PNG: prefer one matching JSON name, else any PNG, else empty
        pngPath = pngFiles.find((p) => jsonFiles.some((j) => p.replace(/\.png$/i, '') === j.replace(/\.json$/i, ''))) || pngFiles[0] || '';
        if (pngPath)
            pngPath = folder + '/' + pngPath;
        // Render map buttons
        mapsEl.innerHTML = mapList.map((m, i) => `<button class="tiled-map-btn" style="background:#0f3460;color:#e0e0e0;border:1px solid #1a508b;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;" data-idx="${i}">${m.name}</button>`).join('');
        mapsEl.querySelectorAll('.tiled-map-btn').forEach(btn => {
            btn.addEventListener('click', () => loadMap(parseInt(btn.dataset.idx)));
        });
        // Load first map
        if (mapList.length)
            await loadMap(0);
    });
    async function loadMap(idx) {
        if (idx < 0 || idx >= mapList.length)
            return;
        currentMapIdx = idx;
        fileEl.textContent = mapList[idx].name;
        // Highlight active button
        mapsEl.querySelectorAll('.tiled-map-btn').forEach((b, i) => {
            b.style.background = i === idx ? '#e94560' : '#0f3460';
            b.style.color = i === idx ? '#fff' : '#e0e0e0';
        });
        // Load and parse JSON
        const metaRaw = await editorApi.readTextFile(mapList[idx].jsonPath);
        if (!metaRaw) {
            document.getElementById('tiled-status').textContent = 'ERROR: Cannot read JSON';
            return;
        }
        const mapJson = JSON.parse(metaRaw);
        if (!pngPath) {
            const ts = mapJson.tilesets?.[0];
            if (ts?.image) {
                // Direct image reference in JSON
                pngPath = currentFolder + '/' + ts.image;
            }
            else if (ts?.source) {
                // External TSX reference — read it to find the image path
                try {
                    const tsxRaw = await editorApi.readTextFile(currentFolder + '/' + ts.source);
                    if (tsxRaw) {
                        const m = tsxRaw.match(/<image\s+source="([^"]+)"/);
                        if (m) {
                            // TSX image path is relative to the TSX file's folder
                            const tsxFolder = (currentFolder + '/' + ts.source).replace(/\/[^/]+$/, '');
                            pngPath = tsxFolder + '/' + m[1];
                        }
                    }
                }
                catch { }
            }
            if (!pngPath) {
                // Last resort: try to resolve relative paths (.. segments)
                const cleanPath = (s) => {
                    const segs = (currentFolder + '/' + s).split('/').filter(Boolean);
                    const out = [];
                    for (const seg of segs) {
                        if (seg === '.')
                            continue;
                        if (seg === '..') {
                            out.pop();
                            continue;
                        }
                        out.push(seg);
                    }
                    return '/' + out.join('/');
                };
                if (ts?.image)
                    pngPath = cleanPath(ts.image);
                else if (ts?.source) {
                    try {
                        const tsxRaw = await editorApi.readTextFile(cleanPath(ts.source));
                        if (tsxRaw) {
                            const m = tsxRaw.match(/<image\s+source="([^"]+)"/);
                            if (m) {
                                pngPath = cleanPath(ts.source.replace(/\/[^/]+$/, '') + '/' + m[1]);
                            }
                        }
                    }
                    catch { }
                }
            }
            if (!pngPath) {
                document.getElementById('tiled-status').textContent = 'ERROR: No PNG tilesheet found';
                return;
            }
        }
        // Call renderTiledMap from tiled-viewer.js
        if (window.renderTiledMap) {
            await window.renderTiledMap(mapJson, pngPath, canvas);
        }
    }
}
// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
    if (localStorage.getItem('bitsOnMap') === '1')
        bitsOnMapCheckbox.checked = true;
    clearEditor();
    updateProjectUI();
}
boot();
//# sourceMappingURL=renderer.js.map
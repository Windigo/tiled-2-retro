"use strict";
/**
 * Tiled Viewer — Renders a Tiled JSON map with zoom and layer toggles.
 * Overlays colored indicators for custom FLAGS property (FLOOR=1, WALL=2, LADDER=4)
 */
let currentState = null;
let visibleLayers = [];
let showFlagsOverlay = true;
// Which individual flag bits to show in the overlay
let flagVisibility = {
    FLOOR: true,
    WALL: true,
    LADDER: true
};
// FLOOR=1, WALL=2, LADDER=4
const FLAG_FLOOR = 1;
const FLAG_WALL = 2;
const FLAG_LADDER = 4;
// Build GID (0-based tile id) → flags bitmask from tileset custom properties
function buildGidFlagsMap(mapJson) {
    const flagsMap = new Map();
    for (const ts of mapJson.tilesets || []) {
        const tiles = ts.tiles;
        if (!tiles)
            continue;
        for (const tileIdStr of Object.keys(tiles)) {
            const localTileId = parseInt(tileIdStr, 10);
            const tileData = tiles[tileIdStr];
            const props = tileData.properties;
            if (!props)
                continue;
            for (const prop of props) {
                if (prop.name.toUpperCase() === 'FLAGS' && (prop.type === 'enum' || prop.type === 'int') && typeof prop.value === 'number') {
                    flagsMap.set(localTileId, prop.value);
                }
            }
        }
    }
    return flagsMap;
}
// Draw colored flag indicators on the canvas (call after tiles are drawn)
// Only draws once per cell (topmost non-zero tile across layers wins), shows ALL flags
// as small colored squares stacked vertically in the top-left corner
function drawFlagsOverlay(ctx, mapJson, gidFlagsMap, tileWidth, tileHeight, mapCols, mapRows) {
    const cells = mapCols * mapRows;
    // Collect first non-zero GID per cell (first visible layer wins)
    const cellGids = new Array(cells).fill(0);
    for (const layer of mapJson.layers) {
        if (layer.type !== 'tilelayer' || !layer.data)
            continue;
        const data = layer.data;
        for (let i = 0; i < data.length; i++) {
            if (data[i] !== 0 && cellGids[i] === 0) {
                cellGids[i] = data[i];
            }
        }
    }
    // Small indicator square size (2px)
    const sq = 2;
    // Draw once per cell
    for (let i = 0; i < cellGids.length; i++) {
        const gid = cellGids[i];
        if (gid === 0)
            continue;
        let firstgid = 0;
        for (const ts of mapJson.tilesets || []) {
            if (ts.firstgid <= gid && ts.firstgid > firstgid)
                firstgid = ts.firstgid;
        }
        const localTileId = gid - firstgid;
        const flags = gidFlagsMap.get(localTileId) || 0;
        if (flags === 0)
            continue;
        const dx = (i % mapCols) * tileWidth;
        const dy = Math.floor(i / mapCols) * tileHeight;
        // Draw one colored dot per active flag, side by side horizontally
        let xOff = dx;
        ctx.globalAlpha = 1;
        if (flagVisibility.WALL && (flags & FLAG_WALL)) {
            ctx.fillStyle = '#e94560'; // rood
            ctx.fillRect(xOff, dy, sq, sq);
            xOff += sq;
        }
        if (flagVisibility.LADDER && (flags & FLAG_LADDER)) {
            ctx.fillStyle = '#16c79a'; // groen
            ctx.fillRect(xOff, dy, sq, sq);
            xOff += sq;
        }
        if (flagVisibility.FLOOR && (flags & FLAG_FLOOR)) {
            ctx.fillStyle = '#0a84ff'; // blauw
            ctx.fillRect(xOff, dy, sq, sq);
        }
    }
}
// Export accessor for renderer.ts
window.tiledGetExportData = () => {
    if (!currentState)
        return null;
    return {
        mapJson: currentState.mapJson,
        zoom: currentState.zoom,
        pngPath: currentState.pngPath,
        tilesheet: currentState.tilesheet,
        tilesets: currentState.tilesets,
        visibleLayers: [...visibleLayers]
    };
};
async function renderTiledMap(mapJson, pngPath, canvas) {
    const ctx = canvas.getContext('2d');
    const tileWidth = mapJson.tilewidth;
    const tileHeight = mapJson.tileheight;
    const mapCols = mapJson.width;
    const mapRows = mapJson.height;
    const api = window.editorApi;
    const dataUrl = await api.loadPngFile(pngPath);
    if (!dataUrl) {
        const st = document.getElementById('tiled-status');
        if (st)
            st.textContent = 'ERROR: Failed to load tilesheet: ' + pngPath;
        return;
    }
    const tilesheet = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = dataUrl;
    });
    // Initialize visible layers (all visible by default)
    visibleLayers = mapJson.layers.map((l) => l.type !== 'tilelayer' || l.visible !== false);
    // Build flags lookup and store state for re-renders (default 300% zoom for Amiga 320×256 screens)
    const gidFlagsMap = buildGidFlagsMap(mapJson);
    currentState = { mapJson, tilesheet, canvas, zoom: 3, pngPath, tilesets: new Map(), gidFlagsMap };
    // Render layer toggles & flag legend
    updateLayerToggles(mapJson);
    renderFlagsLegend();
    // Render zoom
    const zl = document.getElementById('tiled-zoom-label');
    if (zl)
        zl.textContent = '300%';
    draw();
}
function draw() {
    if (!currentState)
        return;
    const { mapJson, tilesheet, canvas, zoom } = currentState;
    const tileWidth = mapJson.tilewidth;
    const tileHeight = mapJson.tileheight;
    const mapCols = mapJson.width;
    const mapRows = mapJson.height;
    // Set canvas bitmap to native size, CSS handles zoom
    canvas.width = mapCols * tileWidth;
    canvas.height = mapRows * tileHeight;
    canvas.style.width = (mapCols * tileWidth * zoom) + 'px';
    canvas.style.height = (mapRows * tileHeight * zoom) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mapJson.backgroundcolor) {
        ctx.fillStyle = mapJson.backgroundcolor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tilesheetCols = Math.floor(tilesheet.width / tileWidth);
    let drawn = 0, skipped = 0;
    for (let li = 0; li < mapJson.layers.length; li++) {
        if (!visibleLayers[li])
            continue;
        const layer = mapJson.layers[li];
        if (layer.type !== 'tilelayer' || !layer.data)
            continue;
        ctx.globalAlpha = (layer.opacity != null) ? layer.opacity : 1;
        const data = layer.data;
        for (let i = 0; i < data.length; i++) {
            const tileId = data[i];
            if (tileId === 0) {
                skipped++;
                continue;
            }
            const actualTileId = tileId - 1;
            const sx = (actualTileId % tilesheetCols) * tileWidth;
            const sy = Math.floor(actualTileId / tilesheetCols) * tileHeight;
            const dx = (i % mapCols) * tileWidth;
            const dy = Math.floor(i / mapCols) * tileHeight;
            ctx.drawImage(tilesheet, sx, sy, tileWidth, tileHeight, dx, dy, tileWidth, tileHeight);
            drawn++;
        }
    }
    ctx.globalAlpha = 1;
    // Draw flags overlay on top of rendered tiles
    if (showFlagsOverlay) {
        drawFlagsOverlay(ctx, mapJson, currentState.gidFlagsMap, tileWidth, tileHeight, mapCols, mapRows);
    }
    // Update status
    const st = document.getElementById('tiled-status');
    if (st)
        st.textContent = `Tilesheet: ${tilesheet.width}×${tilesheet.height} | drawn:${drawn} skipped:${skipped} | ${mapCols}×${mapRows} ${tileWidth}px | zoom:${Math.round(zoom * 100)}%`;
}
function setZoom(z) {
    if (!currentState)
        return;
    currentState.zoom = Math.max(0.1, Math.min(4, z));
    draw();
    const zl = document.getElementById('tiled-zoom-label');
    if (zl)
        zl.textContent = Math.round(currentState.zoom * 100) + '%';
}
function toggleLayer(idx) {
    visibleLayers[idx] = !visibleLayers[idx];
    draw();
    // Update checkbox state
    const cb = document.querySelector(`#tiled-layers input[data-idx="${idx}"]`);
    if (cb)
        cb.checked = visibleLayers[idx];
    const label = cb?.parentElement;
    if (label)
        label.classList.toggle('tv-off', !visibleLayers[idx]);
}
function updateLayerToggles(mapJson) {
    const el = document.getElementById('tiled-layers');
    if (!el)
        return;
    el.innerHTML = mapJson.layers
        .filter((l) => l.type === 'tilelayer')
        .map((l, i) => `<label class="tv-layer${visibleLayers[i] ? '' : ' tv-off'}" style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:3px 6px;border-radius:3px;font-size:11px;color:#a0b0c0;">
                <input type="checkbox" data-idx="${i}" ${visibleLayers[i] ? 'checked' : ''} style="accent-color:#e94560;">
                ${l.name || `Layer ${i + 1}`}
            </label>`).join('');
    el.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt(cb.dataset.idx);
            toggleLayer(idx);
        });
    });
}
function renderFlagsLegend() {
    const el = document.getElementById('tiled-flags-legend');
    if (!el)
        return;
    const flags = [
        { key: 'FLOOR', label: 'Floor', color: '#0a84ff' },
        { key: 'WALL', label: 'Wall', color: '#e94560' },
        { key: 'LADDER', label: 'Ladder', color: '#16c79a' }
    ];
    el.innerHTML = flags.map(f => `<label class="tv-layer" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 6px;border-radius:3px;font-size:11px;color:#a0b0c0;">
      <input type="checkbox" data-flag="${f.key}" ${flagVisibility[f.key] ? 'checked' : ''} style="accent-color:${f.color};">
      <span style="display:inline-block;width:8px;height:8px;background:${f.color};border-radius:1px;"></span>
      ${f.label}
    </label>`).join('');
    el.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            const flagKey = cb.dataset.flag;
            flagVisibility[flagKey] = cb.checked;
            const label = cb.parentElement;
            if (label)
                label.classList.toggle('tv-off', !flagVisibility[flagKey]);
            draw();
        });
    });
}
// Expose globally
window.renderTiledMap = renderTiledMap;
window.tiledSetZoom = setZoom;
//# sourceMappingURL=tiled-viewer.js.map
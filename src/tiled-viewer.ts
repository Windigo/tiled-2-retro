/**
 * Tiled Viewer — Renders a Tiled JSON map with zoom and layer toggles.
 */

let currentState: {
  mapJson: any;
  tilesheet: HTMLImageElement;
  canvas: HTMLCanvasElement;
  zoom: number;
  pngPath: string;
  tilesets: Map<number, { image: HTMLImageElement; path: string }>;
} | null = null;

let visibleLayers: boolean[] = [];

// Export accessor for renderer.ts
(window as any).tiledGetExportData = (): {
  mapJson: any;
  zoom: number;
  pngPath: string;
  tilesets: Map<number, { image: HTMLImageElement; path: string }>;
  visibleLayers: boolean[];
} | null => {
  if (!currentState) return null;
  return {
    mapJson: currentState.mapJson,
    zoom: currentState.zoom,
    pngPath: currentState.pngPath,
    tilesets: currentState.tilesets,
    visibleLayers: [...visibleLayers]
  };
};

async function renderTiledMap(mapJson: any, pngPath: string, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    const tileWidth   = mapJson.tilewidth;
    const tileHeight  = mapJson.tileheight;
    const mapCols     = mapJson.width;
    const mapRows     = mapJson.height;

    const api = (window as any).editorApi;
    const dataUrl = await api.loadPngFile(pngPath);
    if (!dataUrl) {
        const st = document.getElementById('tiled-status');
        if (st) st.textContent = 'ERROR: Failed to load tilesheet: ' + pngPath;
        return;
    }

    const tilesheet = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = dataUrl;
    });

    // Initialize visible layers (all visible by default)
    visibleLayers = mapJson.layers.map((l: any) => l.type !== 'tilelayer' || l.visible !== false);

    // Store state for re-renders (default 300% zoom for Amiga 320×256 screens)
    currentState = { mapJson, tilesheet, canvas, zoom: 3, pngPath, tilesets: new Map() };

    // Render layer toggles
    updateLayerToggles(mapJson);
    // Render zoom
    const zl = document.getElementById('tiled-zoom-label');
    if (zl) zl.textContent = '300%';

    draw();
}

function draw() {
    if (!currentState) return;
    const { mapJson, tilesheet, canvas, zoom } = currentState;

    const tileWidth  = mapJson.tilewidth;
    const tileHeight = mapJson.tileheight;
    const mapCols    = mapJson.width;
    const mapRows    = mapJson.height;

    // Set canvas bitmap to native size, CSS handles zoom
    canvas.width  = mapCols * tileWidth;
    canvas.height = mapRows * tileHeight;
    canvas.style.width  = (mapCols * tileWidth * zoom) + 'px';
    canvas.style.height = (mapRows * tileHeight * zoom) + 'px';

    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mapJson.backgroundcolor) {
        ctx.fillStyle = mapJson.backgroundcolor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const tilesheetCols = Math.floor(tilesheet.width / tileWidth);
    let drawn = 0, skipped = 0;

    for (let li = 0; li < mapJson.layers.length; li++) {
        if (!visibleLayers[li]) continue;
        const layer = mapJson.layers[li];
        if (layer.type !== 'tilelayer' || !layer.data) continue;

        ctx.globalAlpha = (layer.opacity != null) ? layer.opacity : 1;
        const data = layer.data as number[];

        for (let i = 0; i < data.length; i++) {
            const tileId = data[i];
            if (tileId === 0) { skipped++; continue; }

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

    // Update status
    const st = document.getElementById('tiled-status');
    if (st) st.textContent = `Tilesheet: ${tilesheet.width}×${tilesheet.height} | drawn:${drawn} skipped:${skipped} | ${mapCols}×${mapRows} ${tileWidth}px | zoom:${Math.round(zoom*100)}%`;
}

function setZoom(z: number) {
    if (!currentState) return;
    currentState.zoom = Math.max(0.1, Math.min(4, z));
    draw();
    const zl = document.getElementById('tiled-zoom-label');
    if (zl) zl.textContent = Math.round(currentState.zoom * 100) + '%';
}

function toggleLayer(idx: number) {
    visibleLayers[idx] = !visibleLayers[idx];
    draw();
    // Update checkbox state
    const cb = document.querySelector(`#tiled-layers input[data-idx="${idx}"]`) as HTMLInputElement;
    if (cb) cb.checked = visibleLayers[idx];
    const label = cb?.parentElement;
    if (label) label.classList.toggle('tv-off', !visibleLayers[idx]);
}

function updateLayerToggles(mapJson: any) {
    const el = document.getElementById('tiled-layers');
    if (!el) return;
    el.innerHTML = mapJson.layers
        .filter((l: any) => l.type === 'tilelayer')
        .map((l: any, i: number) =>
            `<label class="tv-layer${visibleLayers[i] ? '' : ' tv-off'}" style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:3px 6px;border-radius:3px;font-size:11px;color:#a0b0c0;">
                <input type="checkbox" data-idx="${i}" ${visibleLayers[i] ? 'checked' : ''} style="accent-color:#e94560;">
                ${l.name || `Layer ${i+1}`}
            </label>`
        ).join('');

    el.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            const idx = parseInt((cb as HTMLElement).dataset.idx!);
            toggleLayer(idx);
        });
    });
}

// Expose globally
(window as any).renderTiledMap = renderTiledMap;
(window as any).tiledSetZoom = setZoom;
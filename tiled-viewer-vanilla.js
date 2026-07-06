"use strict";
/**
 * Vanilla JS Tiled Viewer — no frameworks, no lifecycle conflicts.
 * Compiled to tiled-viewer.js and loaded via regular <script> tag.
 */
(function () {
    const api = window.editorApi;
    let mapData = null;
    let folderPath = '';
    let zoom = 1;
    let canvas = null;
    let maps = [];
    let currentIdx = -1;
    let visible = [];
    // ─── Path resolution ────────────────────────────────────────────
    function resolvePath(base, rel) {
        const segs = base.split('/').filter(s => s !== '');
        for (const s of rel.split('/').filter(s => s !== '')) {
            if (s === '.')
                continue;
            if (s === '..') {
                segs.pop();
                continue;
            }
            segs.push(s);
        }
        let result = '/' + segs.join('/');
        const m = result.match(/^\/Volumes\/[^\/]+\/(Users|Applications|System|Library|tmp|opt|usr|bin|sbin|etc|var|home)\//);
        if (m)
            result = '/' + m[1] + '/' + result.substring(m[0].length);
        return result;
    }
    // ─── Rendering ──────────────────────────────────────────────────
    function drawMap() {
        if (!mapData || !canvas)
            return;
        const c = canvas;
        const w = mapData.width * mapData.tilewidth;
        const h = mapData.height * mapData.tileheight;
        c.width = w;
        c.height = h;
        c.style.width = (w * zoom) + 'px';
        c.style.height = (h * zoom) + 'px';
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        // Background
        ctx.fillStyle = mapData.backgroundcolor || '#444';
        ctx.fillRect(0, 0, w, h);
        let drawn = 0, gid0 = 0, noImg = 0;
        for (let li = 0; li < mapData.layers.length; li++) {
            if (!visible[li])
                continue;
            const l = mapData.layers[li];
            if (l.type !== 'tilelayer' || !l.data)
                continue;
            ctx.globalAlpha = l.opacity || 1;
            for (let row = 0; row < l.height; row++) {
                for (let col = 0; col < l.width; col++) {
                    const gid = l.data[row * l.width + col] || 0;
                    if (gid === 0) {
                        gid0++;
                        continue;
                    }
                    let bestTs = null, bestGid = 0;
                    for (const ts of mapData.tilesets) {
                        if (ts.firstgid <= gid && ts.firstgid > bestGid) {
                            bestTs = ts;
                            bestGid = ts.firstgid;
                        }
                    }
                    if (!bestTs || !bestTs.imageElement) {
                        noImg++;
                        continue;
                    }
                    const lid = gid - bestGid;
                    const imgW = bestTs.imageElement.naturalWidth || bestTs.imagewidth || bestTs.tilewidth;
                    const cols = Math.max(1, Math.floor(imgW / bestTs.tilewidth));
                    const sx = (lid % cols) * bestTs.tilewidth;
                    const sy = Math.floor(lid / cols) * bestTs.tileheight;
                    ctx.drawImage(bestTs.imageElement, sx, sy, bestTs.tilewidth, bestTs.tileheight, col * mapData.tilewidth + (l.x || 0), row * mapData.tileheight + (l.y || 0), mapData.tilewidth, mapData.tileheight);
                    drawn++;
                }
            }
        }
        ctx.globalAlpha = 1;
        // Update zoom label
        const zl = document.querySelector('#tv-zoom-label');
        if (zl)
            zl.textContent = Math.round(zoom * 100) + '%';
        // Update status
        const st = document.querySelector('#tv-status');
        if (st) {
            const tsInfo = mapData.tilesets.map((t) => (t.name || 'ts') + ':' + (t.imageElement ? '✓' : '✗')).join(', ');
            st.textContent = `Tilesets: ${mapData.tilesets.length} [${tsInfo}] | drawn:${drawn} gid0:${gid0} noImg:${noImg} | ${mapData.width}x${mapData.height} ${mapData.tilewidth}px`;
        }
    }
    function zoomIn() { zoom = Math.min(4, zoom + 0.25); drawMap(); }
    function zoomOut() { zoom = Math.max(0.1, zoom - 0.25); drawMap(); }
    // ─── Load ───────────────────────────────────────────────────────
    async function loadMap(idx) {
        const path = maps[idx].path;
        const raw = await api.readTextFile(path);
        if (!raw)
            return;
        const map = JSON.parse(raw);
        const jsonFolder = path.substring(0, path.lastIndexOf('/'));
        // Load tileset images
        for (const ts of map.tilesets) {
            let imgPath = null;
            if (ts.image) {
                imgPath = resolvePath(jsonFolder, ts.image);
            }
            if (!imgPath && ts.source) {
                const tsxFile = resolvePath(jsonFolder, ts.source);
                try {
                    const tsxXml = await api.readTextFile(tsxFile);
                    if (tsxXml) {
                        const m1 = tsxXml.match(/<image\s+source="([^"]+)"/);
                        if (m1) {
                            const tsxFolder = tsxFile.substring(0, tsxFile.lastIndexOf('/'));
                            imgPath = resolvePath(tsxFolder, m1[1]);
                        }
                    }
                }
                catch { }
            }
            if (imgPath) {
                try {
                    const url = await api.loadPngFile(imgPath);
                    if (url) {
                        ts.imageElement = await new Promise((res, rej) => {
                            const i = new Image();
                            i.onload = () => res(i);
                            i.onerror = rej;
                            i.src = url;
                        });
                    }
                }
                catch { }
            }
        }
        mapData = map;
        currentIdx = idx;
        visible = map.layers.map((l) => l.visible);
        // Update toolbar file name
        const fn = document.querySelector('#tv-filename');
        if (fn)
            fn.textContent = maps[idx].name;
        // Update map buttons
        updateMapButtons();
        // Update layer toggles
        updateLayers();
        drawMap();
    }
    function updateMapButtons() {
        const el = document.querySelector('#tv-maps');
        if (!el)
            return;
        el.innerHTML = maps.map((m, i) => `<button class="tv-map-btn${i === currentIdx ? ' tv-active' : ''}" data-idx="${i}">${m.name}</button>`).join('');
        el.querySelectorAll('.tv-map-btn').forEach(btn => {
            btn.addEventListener('click', () => loadMap(parseInt(btn.dataset.idx)));
        });
    }
    function updateLayers() {
        const el = document.querySelector('#tv-layers');
        if (!el || !mapData)
            return;
        el.innerHTML = mapData.layers.map((l, i) => `<label class="tv-layer${visible[i] ? '' : ' tv-off'}">
        <input type="checkbox" ${visible[i] ? 'checked' : ''} data-idx="${i}">
        ${l.name || `Layer ${i + 1}`}
      </label>`).join('');
        el.querySelectorAll('input').forEach(cb => {
            cb.addEventListener('change', () => {
                const i = parseInt(cb.dataset.idx);
                visible[i] = !visible[i];
                cb.checked = visible[i];
                (cb.parentElement).classList.toggle('tv-off', !visible[i]);
                drawMap();
            });
        });
    }
    // ─── Browse ─────────────────────────────────────────────────────
    async function browse() {
        const f = await api.pickFolder();
        if (!f)
            return;
        folderPath = f;
        const list = await api.listDirectory(f);
        if (!list)
            return;
        const jsonFiles = list.files.filter((x) => x.toLowerCase().endsWith('.json'));
        maps = jsonFiles.map((x) => ({ name: x, path: resolvePath(f, x) }));
        const fp = document.querySelector('#tv-path');
        if (fp)
            fp.textContent = f;
        if (maps.length)
            await loadMap(0);
    }
    // ─── Setup ──────────────────────────────────────────────────────
    function mount(container) {
        container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#0d1117;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#16213e;border-bottom:1px solid #0f3460;flex-shrink:0;">
          <button id="tv-browse" style="background:#e94560;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">Browse…</button>
          <span id="tv-path" style="font-size:11px;color:#6a7a9a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">No folder selected</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#16213e;border-bottom:1px solid #0f3460;flex-shrink:0;flex-wrap:wrap;">
          <span id="tv-filename" style="font-size:11px;color:#e0e0e0;font-weight:600;margin-right:8px;">—</span>
          <span id="tv-maps" style="display:flex;gap:4px;flex-wrap:wrap;"></span>
          <div style="margin-left:auto;display:flex;align-items:center;gap:4px;">
            <button id="tv-zo" style="background:#0f3460;color:#e0e0e0;border:1px solid #1a508b;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px;">−</button>
            <span id="tv-zoom-label" style="font-size:11px;color:#6a7a9a;min-width:45px;text-align:center;">100%</span>
            <button id="tv-zi" style="background:#0f3460;color:#e0e0e0;border:1px solid #1a508b;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px;">+</button>
          </div>
        </div>
        <div id="tv-canvas-wrap" style="flex:1;overflow:auto;background:#000;border:1px solid #0f3460;margin:8px;border-radius:4px;"></div>
        <div style="background:#16213e;border-top:1px solid #0f3460;padding:4px 8px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex-shrink:0;">
          <span style="font-size:11px;color:#6a7a9a;margin-right:4px;">Layers:</span>
          <span id="tv-layers" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;"></span>
        </div>
        <div id="tv-status" style="font-size:11px;color:#0f0;padding:4px 12px;background:#0d1117;border-top:1px solid #0f3460;flex-shrink:0;min-height:22px;font-family:monospace;"></div>
      </div>
    `;
        // Wire up events
        document.getElementById('tv-browse').addEventListener('click', browse);
        document.getElementById('tv-zo').addEventListener('click', zoomOut);
        document.getElementById('tv-zi').addEventListener('click', zoomIn);
        const wrap = document.getElementById('tv-canvas-wrap');
        canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.imageRendering = 'pixelated';
        wrap.appendChild(canvas);
        wrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            zoom = Math.max(0.1, Math.min(4, zoom + (e.deltaY > 0 ? -0.1 : 0.1)));
            drawMap();
        });
    }
    // Expose to global scope
    window.__tiledViewerMount = mount;
})();
//# sourceMappingURL=tiled-viewer-vanilla.js.map
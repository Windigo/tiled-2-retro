// JSZip is loaded via <script> tag in index.html (renderer has no Node require)
declare var JSZip: any;

declare const editorApi: {
  pickPng: () => Promise<{ dataUrl: string; fileName: string } | null>;
  pickFolder: (defaultPath?: string) => Promise<string | null>;
  saveIffDialog: (defaultName?: string) => Promise<string | null>;
  writeFile: (filePath: string, data: number[]) => Promise<boolean>;
  loadPngFile: (filePath: string) => Promise<string | null>;
  readTextFile: (filePath: string) => Promise<string | null>;
  listDirectory: (dirPath: string) => Promise<{ path: string; folders: string[]; files: string[] } | null>;
  exportAmiga: (data: { projectFolder: string; iffData: number[]; iffBitplanes: number; mapsAb3Data: number[]; gameAb3Data: number[] }) => Promise<boolean>;
};

// ─── Toast ─────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: 'success' | 'error' = 'success', durationMs = 2500): void {
  const el = document.getElementById('toast')!;
  if (toastTimer) clearTimeout(toastTimer);
  el.textContent = message;
  el.className = 'toast ' + type;
  void el.offsetWidth;
  el.classList.remove('hidden');
  toastTimer = setTimeout(() => { el.classList.add('hidden'); toastTimer = null; }, durationMs);
}

function formatSize(bytes: number): string { return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'; }

// ─── IFF building helpers ─────────────────────────────────────────────────────

function putU16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >> 8) & 0xFF;
  buf[offset + 1] = value & 0xFF;
}

function putU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >> 24) & 0xFF;
  buf[offset + 1] = (value >> 16) & 0xFF;
  buf[offset + 2] = (value >> 8) & 0xFF;
  buf[offset + 3] = value & 0xFF;
}

function iffChunk(type: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length & 1);
  const out = new Uint8Array(8 + padded);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  putU32BE(out, 4, data.length);
  out.set(data, 8);
  return out;
}

function frequencyQuantize(rgb: Uint8ClampedArray, maxColors: number): { palette: Uint8Array; indexMap: Uint8Array } {
  const numPixels = rgb.length / 4;
  if (numPixels === 0 || maxColors === 0) {
    return { palette: new Uint8Array(0), indexMap: new Uint8Array(0) };
  }

  const colorFreq = new Map<number, number>();
  const colorRGB = new Map<number, [number, number, number]>();
  for (let i = 0; i < numPixels; i++) {
    const off = i * 4;
    const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
    const key = (r << 16) | (g << 8) | b;
    colorFreq.set(key, (colorFreq.get(key) || 0) + 1);
    if (!colorRGB.has(key)) colorRGB.set(key, [r, g, b]);
  }

  const entries = Array.from(colorFreq.entries()).sort((a, b) => b[1] - a[1]);
  const palette = new Uint8Array(maxColors * 3);
  const colorToIdx = new Map<number, number>();
  const actualColors = Math.min(maxColors, entries.length);
  for (let i = 0; i < actualColors; i++) {
    const [key, _] = entries[i];
    const [r, g, b] = colorRGB.get(key)!;
    palette[i * 3] = r;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
    colorToIdx.set(key, i);
  }

  const indexMap = new Uint8Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    const off = i * 4;
    const key = (rgb[off] << 16) | (rgb[off + 1] << 8) | rgb[off + 2];
    indexMap[i] = colorToIdx.get(key) ?? findClosestColor(rgb[off], rgb[off + 1], rgb[off + 2], palette, actualColors);
  }
  return { palette, indexMap };
}

function findClosestColor(r: number, g: number, b: number, palette: Uint8Array, numColors: number): number {
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < numColors; i++) {
    const off = i * 3;
    const dr = r - palette[off], dg = g - palette[off + 1], db = b - palette[off + 2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}

function buildIffFromImage(img: HTMLImageElement, nPlanes: number): { iff: Uint8Array; palette: Uint8Array; indexMap: Uint8Array } {
  const w = img.width;
  const h = img.height;
  const maxColors = 1 << nPlanes;
  const bytesPerRow = ((w + 15) >> 4) << 1;

  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
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

  const bmhd = new Uint8Array(20);
  putU16BE(bmhd, 0, w);
  putU16BE(bmhd, 2, h);
  putU16BE(bmhd, 4, 0); putU16BE(bmhd, 6, 0);
  bmhd[8] = nPlanes; bmhd[9] = 0; bmhd[10] = 0; bmhd[11] = 0;
  putU16BE(bmhd, 12, 0);
  bmhd[14] = 44; bmhd[15] = 52;
  putU16BE(bmhd, 16, w);
  putU16BE(bmhd, 18, h);

  const bmhdChunk = iffChunk('BMHD', bmhd);
  const cmapChunk = iffChunk('CMAP', cmap);
  const bodyChunk = iffChunk('BODY', body);

  const ilbmInner = new Uint8Array(4 + bmhdChunk.length + cmapChunk.length + bodyChunk.length);
  let p = 0;
  ilbmInner.set([0x49, 0x4C, 0x42, 0x4D], p); p += 4;
  ilbmInner.set(bmhdChunk, p); p += bmhdChunk.length;
  ilbmInner.set(cmapChunk, p); p += cmapChunk.length;
  ilbmInner.set(bodyChunk, p);

  const form = new Uint8Array(8 + ilbmInner.length);
  form.set([0x46, 0x4F, 0x52, 0x4D], 0);
  putU32BE(form, 4, ilbmInner.length);
  form.set(ilbmInner, 8);

  return { iff: form, palette, indexMap };
}

function stringToAmigaBytes(str: string): Uint8Array {
  const clean = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const buf = new Uint8Array(clean.length);
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code === 0x0A) buf[i] = 0x0A;
    else if (code >= 0x20 && code <= 0x7E) buf[i] = code;
    else buf[i] = 0x3F;
  }
  return buf;
}

// ─── Tiled export helpers ────────────────────────────────────────────────────

interface TiledLayerMeta { name: string; visible: boolean; type: string; data: number[]; width: number; height: number; opacity: number; x: number; y: number; }

function gidToTile(gid: number): number { return gid > 0 ? gid - 1 : 0; }

function buildTiledMapAb3(mapJson: any, bitplanes: number, imageWidth?: number, imageHeight?: number): string {
  const tileSize = mapJson.tilewidth;
  const mapCols = mapJson.width;
  const mapRows = mapJson.height;
  const cells = mapCols * mapRows;

  const allTiles: number[] = new Array(cells).fill(0);
  for (const layer of mapJson.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    for (let i = 0; i < cells; i++) {
      const gid = layer.data[i] || 0;
      if (gid === 0) continue; // don't overwrite with empty
      let bestFirstgid = 0;
      for (const ts of mapJson.tilesets) {
        if (ts.firstgid <= gid && ts.firstgid > bestFirstgid) bestFirstgid = ts.firstgid;
      }
      const tile = gid - bestFirstgid;
      if (tile > 0) allTiles[i] = tile;
    }
  }

  const dataLines: string[] = [];
  for (let i = 0; i < allTiles.length; i += 16) {
    dataLines.push(`Data.w ${allTiles.slice(i, i + 16).join(',')}`);
  }

  const ts0 = mapJson.tilesets?.[0];
  const sheetW = imageWidth ?? ts0?.imagewidth ?? 320;
  const sheetH = imageHeight ?? ts0?.imageheight ?? 256;
  const sheetCols = Math.max(1, Math.floor(sheetW / tileSize));
  const bp = bitplanes;
  const iffFilename = `tiles_${bp}bp.iff`;

  return `; ---------------------------------------------------------------
; map.ab3 -- Tiled map export via Tiled2Retro
; Draw-only: laadt ${iffFilename} en tekent de map
; ---------------------------------------------------------------

#MAP_COLS   = ${mapCols}
#MAP_ROWS   = ${mapRows}
#TILE_SIZE  = ${tileSize}
#CELLS      = ${cells}
#SHEET_COLS = ${sheetCols}
#SHEET_W    = ${sheetW}
#SHEET_H    = ${sheetH}
#BITPLANES  = ${bp}

Dim tilemap.w(${cells})

; --- Load map data ---
Restore MapData
For i = 0 To ${cells - 1}
  Read tilemap(i)
Next i

; --- Setup (Amiga mode) ---
BitMap 0, ${sheetW}, ${sheetH}, #BITPLANES
BitMap 1, ${mapCols * tileSize}, ${mapRows * tileSize}, #BITPLANES

LoadBitMap 0, "${iffFilename}", 0
VWait 100

BLITZ
Slice 0, 44, #BITPLANES
Use BitMap 0
Use Palette 0
Show 1

; --- Teken de map ---
For y = 0 To #MAP_ROWS - 1
  For x = 0 To #MAP_COLS - 1
    idx    = y * #MAP_COLS + x
    tile.w = tilemap(idx)
    If tile = 0 Then Goto skipTile
    srcX.w = (tile MOD #SHEET_COLS) * #TILE_SIZE
    srcY.w = tile / #SHEET_COLS
    srcY   = srcY * #TILE_SIZE
    dstX   = x * #TILE_SIZE
    dstY   = y * #TILE_SIZE
    Use BitMap 0
    GetaShape 0, srcX, srcY, #TILE_SIZE, #TILE_SIZE
    Use BitMap 1
    Blit 0, dstX, dstY
    .skipTile:
  Next x
Next y

Show 1
MouseWait
AMIGA
End

.MapData:
${dataLines.join('\n')}
`;
}

// ─── Game AB3 (sprite + joystick gameloop) ────────────────────────────────────

// Build a tile → flags lookup map from tileset custom properties
// FLAGS property is an enum with: FLOOR=1, WALL=2, LADDER=4
function buildTileFlagsMap(mapJson: any): Map<number, number> {
  const flagsMap = new Map<number, number>();
  for (const ts of mapJson.tilesets || []) {
    const tiles = ts.tiles;
    if (!tiles) continue;
    for (const tileIdStr of Object.keys(tiles)) {
      const tileId = parseInt(tileIdStr, 10);
      const tileData = tiles[tileIdStr];
      const props = tileData.properties;
      if (!props) continue;
      for (const prop of props) {
        if (prop.name.toUpperCase() === 'FLAGS' && (prop.type === 'enum' || prop.type === 'int') && typeof prop.value === 'number') {
          flagsMap.set(tileId, prop.value);
        }
      }
    }
  }
  return flagsMap;
}

function buildGameAb3(
  mapJson: any,
  bitplanes: number,
  spriteTileId: number,
  imageWidth?: number,
  imageHeight?: number
): string {
  const tileSize = mapJson.tilewidth;
  const mapCols = mapJson.width;
  const mapRows = mapJson.height;
  const cells = mapCols * mapRows;

  // Build tile → flags lookup
  const tileFlagsMap = buildTileFlagsMap(mapJson);

  // FLOOR=1, WALL=2, LADDER=4
  const FLOOR = 1;
  const WALL = 2;
  const LADDER = 4;

  const allTiles: number[] = new Array(cells).fill(0);
  for (const layer of mapJson.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    for (let i = 0; i < cells; i++) {
      const gid = layer.data[i] || 0;
      if (gid === 0) continue; // don't overwrite with empty
      let bestFirstgid = 0;
      for (const ts of mapJson.tilesets) {
        if (ts.firstgid <= gid && ts.firstgid > bestFirstgid) bestFirstgid = ts.firstgid;
      }
      const tile = gid - bestFirstgid;
      if (tile > 0) allTiles[i] = tile;
    }
  }

  // Build tile flags array (parallel to allTiles)
  const tileFlags: number[] = new Array(cells).fill(0);
  for (let i = 0; i < cells; i++) {
    const tileId = allTiles[i];
    if (tileId > 0) {
      tileFlags[i] = tileFlagsMap.get(tileId) || 0;
    }
  }

  const dataLines: string[] = [];
  for (let i = 0; i < allTiles.length; i += 16) {
    dataLines.push(`Data.w ${allTiles.slice(i, i + 16).join(',')}`);
  }

  const flagsLines: string[] = [];
  for (let i = 0; i < tileFlags.length; i += 16) {
    flagsLines.push(`Data.w ${tileFlags.slice(i, i + 16).join(',')}`);
  }

  const ts0 = mapJson.tilesets?.[0];
  const sheetW = imageWidth ?? ts0?.imagewidth ?? 320;
  const sheetH = imageHeight ?? ts0?.imageheight ?? 256;
  const sheetCols = Math.max(1, Math.floor(sheetW / tileSize));
  const bp = bitplanes;
  const iffFilename = `tiles_${bp}bp.iff`;

  // Tile → sheet coordinates
  const tId = spriteTileId;
  const srcX = (tId % sheetCols) * tileSize;
  const srcY = Math.floor(tId / sheetCols) * tileSize;

  return `; ---------------------------------------------------------------
; game.ab3 -- Game loop met sprite (tile ${spriteTileId}) + joystick
; Tiled map export via Tiled2Retro
; ---------------------------------------------------------------

#MAP_COLS    = ${mapCols}
#MAP_ROWS    = ${mapRows}
#TILE_SIZE   = ${tileSize}
#CELLS       = ${cells}
#SHEET_COLS  = ${sheetCols}
#SHEET_W     = ${sheetW}
#SHEET_H     = ${sheetH}
#BITPLANES   = ${bp}
#SPRITE_TILE = ${spriteTileId}
#SPRITE_SRCX = ${srcX}
#SPRITE_SRCY = ${srcY}

#FLAG_FLOOR  = ${FLOOR}
#FLAG_WALL   = ${WALL}
#FLAG_LADDER = ${LADDER}
#MAX_VY      = 6

Dim tilemap.w(${cells})
Dim tileflags.w(${cells})

; ==============================================================
; AMIGA mode: laad tilesheet, map data, bouw sprite
; ==============================================================

; --- Laad tilesheet IFF ---
BitMap 0, ${sheetW}, ${sheetH}, #BITPLANES
LoadBitMap 0, "${iffFilename}", 0

; --- Lees map data ---
Restore MapData
For i = 0 To ${cells - 1}
  Read tilemap(i)
Next i

; --- Lees tile flags ---
Restore FlagData
For i = 0 To ${cells - 1}
  Read tileflags(i)
Next i

; --- Bouw map op BitMap 1 ---
BitMap 1, ${mapCols * tileSize}, ${mapRows * tileSize}, #BITPLANES

For y = 0 To #MAP_ROWS - 1
  For x = 0 To #MAP_COLS - 1
    idx    = y * #MAP_COLS + x
    tile.w = tilemap(idx)
    If tile = 0 Then Goto skipBuild
    sx.w = (tile MOD #SHEET_COLS) * #TILE_SIZE
    sy.w = tile / #SHEET_COLS
    sy   = sy * #TILE_SIZE
    Use BitMap 0
    GetaShape 0, sx, sy, #TILE_SIZE, #TILE_SIZE
    Use BitMap 1
    Blit 0, x * #TILE_SIZE, y * #TILE_SIZE
    .skipBuild:
  Next x
Next y

; --- Pak sprite-tile uit de sheet ---
Use BitMap 0
GetaShape 1, #SPRITE_SRCX, #SPRITE_SRCY, #TILE_SIZE, #TILE_SIZE
GetaSprite 0, 1
Free Shape 1

VWait 50

; ==============================================================
; BLITZ mode: display + game loop
; ==============================================================

BLITZ

; --- NEWTYPE voor de speler ---
NEWTYPE .player
  x.w
  y.w
  vy.w
  onGround.w
  speed.w
  gravity.w
  jumpForce.w
  maxVy.w
  jumpPressed.w
  jumpHold.w
  ladderTimer.w
  state.w
End NEWTYPE

; Display BitMap met map
Slice 0, 44, #BITPLANES
Use BitMap 0
Use Palette 0
Show 1

; --- Player initialisatie ---
player.player\\x  = 156
player\\y         = 124
player\\vy        = 0
player\\onGround  = 0
player\\speed     = 2
player\\gravity   = 1
player\\jumpForce = 5
player\\maxVy     = #MAX_VY
player\\jumpPressed = 0
player\\jumpHold    = 0
player\\ladderTimer = 0
player\\state       = 0

; States: 0=Walking 1=Climbing 2=Jumping 3=Falling

; ==============================================================
; Game loop - state machine
; ==============================================================

Repeat
  ; --- Joystick input lezen ---
  jx = Joyx(1)
  jy = Joyy(1)
  jb = Joyb(1)

  ; ==============================================================
  ; Ladder detectie (gedeeld)
  ; ==============================================================
  footY.w  = player\\y + #TILE_SIZE
  midX.w   = player\\x + (#TILE_SIZE / 2)
  midTileX.w = midX / #TILE_SIZE
  footTileY.w = footY / #TILE_SIZE

  onLadder = 0

  ; Check midden-positie op voet-hoogte
  idx = footTileY * #MAP_COLS + midTileX
  If idx >= 0 AND idx < #CELLS
    f.w = tileflags(idx)
    If f & #FLAG_LADDER Then onLadder = 1
  EndIf

  ; Check midden-positie op body-hoogte
  bodyTileY.w = player\\y / #TILE_SIZE
  idx = bodyTileY * #MAP_COLS + midTileX
  If idx >= 0 AND idx < #CELLS
    f.w = tileflags(idx)
    If f & #FLAG_LADDER Then onLadder = 1
  EndIf

  ; ==============================================================
  ; STATE 0: WALKING
  ; ==============================================================
  If player\\state = 0
    ; --- Ladder climbing start? ---
    ; Omhoog: altijd klimmen als je op/naast een ladder staat
    ; Omlaag: alleen klimmen als je NIET op een FLOOR tile staat
    If onLadder = 1 AND jb = 0
      canClimb = 0
      If jy = -1
        canClimb = 1
      EndIf
      If jy = 1
        footCX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
        footCY.w = (player\\y + #TILE_SIZE) / #TILE_SIZE
        fIdx = footCY * #MAP_COLS + footCX
        If fIdx >= 0 AND fIdx < #CELLS
          If tilemap(fIdx) = 0 OR (tileflags(fIdx) & #FLAG_FLOOR) = 0
            canClimb = 1
          EndIf
        Else
          canClimb = 1
        EndIf
      EndIf
      If canClimb = 1
        player\\state = 1
        player\\x = midTileX * #TILE_SIZE
        Goto skipState
      EndIf
    EndIf

    ; --- Jump start? (edge-triggered) ---
    If jb = 1 AND player\\jumpPressed = 0
      player\\vy           = -player\\jumpForce
      player\\onGround     = 0
      player\\jumpPressed   = 1
      player\\jumpHold      = 0
      player\\state        = 2
    Else
      ; Horizontale beweging met WALL collision
      If jx = -1
        newX.w = player\\x - player\\speed
        tileX.w = newX / #TILE_SIZE
        topY.w  = player\\y / #TILE_SIZE
        botY.w  = (player\\y + #TILE_SIZE - 1) / #TILE_SIZE
        tIdx1 = topY * #MAP_COLS + tileX
        tIdx2 = botY * #MAP_COLS + tileX
        canMove = 1
        If tIdx1 >= 0 AND tIdx1 < #CELLS
          f.w = tileflags(tIdx1)
          If f & #FLAG_WALL Then canMove = 0
        EndIf
        If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
          f.w = tileflags(tIdx2)
          If f & #FLAG_WALL Then canMove = 0
        EndIf
        If canMove = 1 Then player\\x = newX
      EndIf

      If jx = 1
        newX.w = player\\x + player\\speed
        tileX.w = (newX + #TILE_SIZE - 1) / #TILE_SIZE
        topY.w  = player\\y / #TILE_SIZE
        botY.w  = (player\\y + #TILE_SIZE - 1) / #TILE_SIZE
        tIdx1 = topY * #MAP_COLS + tileX
        tIdx2 = botY * #MAP_COLS + tileX
        canMove = 1
        If tIdx1 >= 0 AND tIdx1 < #CELLS
          f.w = tileflags(tIdx1)
          If f & #FLAG_WALL Then canMove = 0
        EndIf
        If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
          f.w = tileflags(tIdx2)
          If f & #FLAG_WALL Then canMove = 0
        EndIf
        If canMove = 1 Then player\\x = newX
      EndIf

      ; Check of speler nog op vloer staat (FLOOR of LADDER)
      footCheckX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
      footCheckY.w = (player\\y + #TILE_SIZE) / #TILE_SIZE
      fIdx = footCheckY * #MAP_COLS + footCheckX
      If fIdx >= 0 AND fIdx < #CELLS
        If tilemap(fIdx) > 0 AND ((tileflags(fIdx) & #FLAG_FLOOR) OR (tileflags(fIdx) & #FLAG_LADDER))
          ; op vloer of ladder - blijf walking
        Else
          ; zwevend -> start falling
          player\\state = 3
        EndIf
      Else
        player\\state = 3
      EndIf
    EndIf

    Goto skipState
  EndIf

  ; ==============================================================
  ; STATE 1: CLIMBING (alleen omhoog/omlaag op ladder)
  ; ==============================================================
  If player\\state = 1
    ; --- Jump van ladder af (fire button) ---
    If jb = 1 AND player\\jumpPressed = 0
      player\\vy           = -player\\jumpForce
      player\\onGround     = 0
      player\\jumpPressed   = 1
      player\\jumpHold      = 0
      player\\state        = 2
      Goto skipState
    EndIf

    ; --- Geen ladder meer? -> check rijen op FLOOR/LADDER onder voeten ---
    If onLadder = 0
      footCX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
      footCY.w = (player\\y + #TILE_SIZE) / #TILE_SIZE

      ; Rij 0 (huidig) — FLOOR of LADDER
      fIdx = footCY * #MAP_COLS + footCX
      If fIdx >= 0 AND fIdx < #CELLS
        If tilemap(fIdx) > 0 AND ((tileflags(fIdx) & #FLAG_FLOOR) OR (tileflags(fIdx) & #FLAG_LADDER))
          player\\y   = footCY * #TILE_SIZE - #TILE_SIZE
          player\\vy  = 0
          player\\state = 0
          player\\onGround = 1
          Goto skipState
        EndIf
      EndIf

      ; Rij +1
      fIdx = (footCY + 1) * #MAP_COLS + footCX
      If fIdx >= 0 AND fIdx < #CELLS
        If tilemap(fIdx) > 0 AND ((tileflags(fIdx) & #FLAG_FLOOR) OR (tileflags(fIdx) & #FLAG_LADDER))
          player\\y   = (footCY + 1) * #TILE_SIZE - #TILE_SIZE
          player\\vy  = 0
          player\\state = 0
          player\\onGround = 1
          Goto skipState
        EndIf
      EndIf

      ; Rij +2
      fIdx = (footCY + 2) * #MAP_COLS + footCX
      If fIdx >= 0 AND fIdx < #CELLS
        If tilemap(fIdx) > 0 AND ((tileflags(fIdx) & #FLAG_FLOOR) OR (tileflags(fIdx) & #FLAG_LADDER))
          player\\y   = (footCY + 2) * #TILE_SIZE - #TILE_SIZE
          player\\vy  = 0
          player\\state = 0
          player\\onGround = 1
          Goto skipState
        EndIf
      EndIf

      player\\state = 3
      Goto skipState
    EndIf

    ; --- Klimmen omhoog: 2 px per frame ---
    If jy = -1
      player\\y = player\\y - 2
      If player\\y < 0 Then player\\y = 0
    EndIf
    If jy = 1
      ; Klim omlaag: 2 px, check of we op een FLOOR tile terechtkomen
      newY.w = player\\y + 2
      footCheckX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
      footCheckY.w = (newY + #TILE_SIZE) / #TILE_SIZE
      fDownIdx = footCheckY * #MAP_COLS + footCheckX
      If fDownIdx >= 0 AND fDownIdx < #CELLS
        If tilemap(fDownIdx) > 0 AND (tileflags(fDownIdx) & #FLAG_FLOOR)
          ; Sta op FLOOR tile -> clamp op top en ga naar walking
          player\\y   = footCheckY * #TILE_SIZE - #TILE_SIZE
          player\\vy  = 0
          player\\state = 0
          player\\onGround = 1
          Goto skipState
        EndIf
      EndIf
      ; Geen floor? Gewoon 2px omlaag
      player\\y = newY
    EndIf

    player\\vy = 0
    Goto skipState
  EndIf

  ; ==============================================================
  ; STATE 2: JUMPING (omhoog)
  ; ==============================================================
  If player\\state = 2
    ; Edge-trigger reset
    If jb = 0 Then player\\jumpPressed = 0

    ; Variable jump height: hold fire om langer omhoog te gaan
    If jb = 1 AND player\\vy < 0 AND player\\jumpHold < 5
      player\\jumpHold = player\\jumpHold + 1
      ; skip gravity dit frame
    Else
      player\\vy = player\\vy + player\\gravity
      If player\\vy >= 0
        player\\state = 3 ; top bereikt -> vallen
      EndIf
    EndIf

    If player\\vy > player\\maxVy Then player\\vy = player\\maxVy
    player\\y = player\\y + player\\vy

    ; Horizontale beweging in de lucht
    If jx = -1
      newX.w = player\\x - player\\speed
      tileX.w = newX / #TILE_SIZE
      tIdx1 = (player\\y / #TILE_SIZE) * #MAP_COLS + tileX
      tIdx2 = ((player\\y + #TILE_SIZE - 1) / #TILE_SIZE) * #MAP_COLS + tileX
      canMove = 1
      If tIdx1 >= 0 AND tIdx1 < #CELLS
        If tileflags(tIdx1) & #FLAG_WALL Then canMove = 0
      EndIf
      If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
        If tileflags(tIdx2) & #FLAG_WALL Then canMove = 0
      EndIf
      If canMove = 1 Then player\\x = newX
    EndIf
    If jx = 1
      newX.w = player\\x + player\\speed
      tileX.w = (newX + #TILE_SIZE - 1) / #TILE_SIZE
      tIdx1 = (player\\y / #TILE_SIZE) * #MAP_COLS + tileX
      tIdx2 = ((player\\y + #TILE_SIZE - 1) / #TILE_SIZE) * #MAP_COLS + tileX
      canMove = 1
      If tIdx1 >= 0 AND tIdx1 < #CELLS
        If tileflags(tIdx1) & #FLAG_WALL Then canMove = 0
      EndIf
      If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
        If tileflags(tIdx2) & #FLAG_WALL Then canMove = 0
      EndIf
      If canMove = 1 Then player\\x = newX
    EndIf

    ; Floor collision check (alleen bij dalen)
    If player\\vy >= 0
      fCheckX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
      fCheckY.w = (player\\y + #TILE_SIZE) / #TILE_SIZE
      fIdx = fCheckY * #MAP_COLS + fCheckX
      If fIdx >= 0 AND fIdx < #CELLS
        If tilemap(fIdx) > 0 AND (tileflags(fIdx) & #FLAG_FLOOR)
          player\\y   = fCheckY * #TILE_SIZE - #TILE_SIZE
          player\\vy  = 0
          player\\state = 0 ; land -> walking
        EndIf
      EndIf
    EndIf

    Goto skipState
  EndIf

  ; ==============================================================
  ; STATE 3: FALLING
  ; ==============================================================
  If player\\state = 3
    ; Gravity
    player\\vy = player\\vy + player\\gravity
    If player\\vy > player\\maxVy Then player\\vy = player\\maxVy
    player\\y = player\\y + player\\vy

    ; Horizontale beweging in de lucht
    If jx = -1
      newX.w = player\\x - player\\speed
      tileX.w = newX / #TILE_SIZE
      tIdx1 = (player\\y / #TILE_SIZE) * #MAP_COLS + tileX
      tIdx2 = ((player\\y + #TILE_SIZE - 1) / #TILE_SIZE) * #MAP_COLS + tileX
      canMove = 1
      If tIdx1 >= 0 AND tIdx1 < #CELLS
        If tileflags(tIdx1) & #FLAG_WALL Then canMove = 0
      EndIf
      If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
        If tileflags(tIdx2) & #FLAG_WALL Then canMove = 0
      EndIf
      If canMove = 1 Then player\\x = newX
    EndIf
    If jx = 1
      newX.w = player\\x + player\\speed
      tileX.w = (newX + #TILE_SIZE - 1) / #TILE_SIZE
      tIdx1 = (player\\y / #TILE_SIZE) * #MAP_COLS + tileX
      tIdx2 = ((player\\y + #TILE_SIZE - 1) / #TILE_SIZE) * #MAP_COLS + tileX
      canMove = 1
      If tIdx1 >= 0 AND tIdx1 < #CELLS
        If tileflags(tIdx1) & #FLAG_WALL Then canMove = 0
      EndIf
      If tIdx2 >= 0 AND tIdx2 < #CELLS AND canMove = 1
        If tileflags(tIdx2) & #FLAG_WALL Then canMove = 0
      EndIf
      If canMove = 1 Then player\\x = newX
    EndIf

    ; Floor collision check
    fCheckX.w = (player\\x + #TILE_SIZE/2) / #TILE_SIZE
    fCheckY.w = (player\\y + #TILE_SIZE) / #TILE_SIZE
    fIdx = fCheckY * #MAP_COLS + fCheckX
    If fIdx >= 0 AND fIdx < #CELLS
      If tilemap(fIdx) > 0 AND (tileflags(fIdx) & #FLAG_FLOOR)
        player\\y   = fCheckY * #TILE_SIZE - #TILE_SIZE
        player\\vy  = 0
        player\\state     = 0 ; land -> walking
        player\\jumpPressed = 0
      EndIf
    EndIf

    Goto skipState
  EndIf

  .skipState:

  ; --- Scherm-grenzen ---
  If player\\x < 0   Then player\\x = 0
  If player\\x > 304 Then player\\x = 304
  If player\\y > 248
    player\\y       = 248
    player\\vy      = 0
    player\\state   = 0
  EndIf
  If player\\y < 0 Then player\\y = 0

  ; --- Render sprite ---
  ShowSprite 0, player\\x, player\\y, 0

  VWait

Until Joyb(1) = 2

AMIGA
End

.MapData:
${dataLines.join('\n')}

.FlagData:
${flagsLines.join('\n')}
`;
}

// ─── TAB SWITCHING ────────────────────────────────────────────────────────

const tabTiledViewer = document.getElementById('tab-tiled-viewer') as HTMLButtonElement;
const tabPngIff = document.getElementById('tab-png-iff') as HTMLButtonElement;
const contentTiledViewer = document.getElementById('tab-content-tiled-viewer')!;
const contentPngIff = document.getElementById('tab-content-png-iff')!;

function deactivateAllTabs(): void {
  tabTiledViewer.classList.remove('active');
  tabPngIff.classList.remove('active');
  contentTiledViewer.classList.remove('active');
  contentPngIff.classList.remove('active');
}

function switchTab(tabName: string): void {
  deactivateAllTabs();
  if (tabName === 'png-iff') {
    tabPngIff.classList.add('active');
    contentPngIff.classList.add('active');
  } else {
    tabTiledViewer.classList.add('active');
    contentTiledViewer.classList.add('active');
    initTiledViewerTab();
  }
}

tabTiledViewer.addEventListener('click', () => switchTab('tiled-viewer'));
tabPngIff.addEventListener('click', () => switchTab('png-iff'));

// ─── CUSTOM MENU BAR ─────────────────────────────────────────────────────

document.querySelectorAll('#menu-bar .menu-item').forEach(el => {
  el.addEventListener('click', () => {
    const action = (el as HTMLElement).dataset.action;
    if (action === 'tab-tiled-viewer') switchTab('tiled-viewer');
    else if (action === 'tab-png-iff') switchTab('png-iff');
  });
});

// ─── TILED VIEWER TAB ─────────────────────────────────────────────────────

let tiledViewerInitialized = false;

function initTiledViewerTab(): void {
  if (tiledViewerInitialized) return;
  tiledViewerInitialized = true;

  const browseBtn = document.getElementById('tiled-browse') as HTMLButtonElement;
  const pathEl = document.getElementById('tiled-path') as HTMLSpanElement;
  const fileEl = document.getElementById('tiled-filename') as HTMLSpanElement;
  const mapsEl = document.getElementById('tiled-maps') as HTMLSpanElement;
  const canvas = document.getElementById('tiled-canvas') as HTMLCanvasElement;
  const canvasWrap = document.getElementById('tiled-canvas-wrap') as HTMLElement;
  const exportBtn = document.getElementById('tiled-export-amiga') as HTMLButtonElement;
  let currentZoom = 3;

  if (canvasWrap) canvasWrap.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    currentZoom = Math.max(0.1, Math.min(4, currentZoom + (e.deltaY > 0 ? -0.1 : 0.1)));
    (window as any).tiledSetZoom?.(currentZoom);
  });

  let currentFolder = '';
  let mapList: { name: string; jsonPath: string }[] = [];
  let currentMapIdx = -1;
  let pngPath = '';
  let tiledIffBitplanes = 3; // Default bitplanes for tilesheet IFF export (8 colors)
  let tiledIffLastResult: { palette: Uint8Array; indexMap: Uint8Array; iff: Uint8Array } | null = null;
  let tiledTilesheetImage: HTMLImageElement | null = null;

  async function doTiledExport(): Promise<void> {
    const exportData = (window as any).tiledGetExportData?.();
    if (!exportData) { showToast('No map loaded for export', 'error'); return; }
    const { mapJson } = exportData;
    if (!mapJson || !mapJson.layers) { showToast('Invalid map data', 'error'); return; }

    const ts0 = mapJson.tilesets?.[0];
    let imgW = ts0?.imagewidth || 320;
    let imgH = ts0?.imageheight || 256;
    let image: HTMLImageElement | null = null;
    if (exportData.pngPath) {
      const dataUrl = await editorApi.loadPngFile(exportData.pngPath);
      if (dataUrl) {
        image = await new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.onload = () => { imgW = img.width; imgH = img.height; resolve(img); };
          img.onerror = () => resolve(null!);
          img.src = dataUrl;
        });
      }
    }

    const bp = tiledIffBitplanes;
    let iffData: Uint8Array | null = null;
    if (image) {
      iffData = buildIffFromImage(image, bp).iff;
    }

    const mapsAb3raw = buildTiledMapAb3(mapJson, bp, imgW, imgH);
    const mapsAb3Bytes = stringToAmigaBytes(mapsAb3raw);

    // Sprite tile ID (tile 459 = tile_id in Tiled, 0-based index 459)
    // The sprite tile ID is passed as a constant to the generated game.ab3
    const gameAb3Bytes = stringToAmigaBytes(
      buildGameAb3(mapJson, bp, 459, imgW, imgH)
    );

    if (!currentFolder) { showToast('No folder selected', 'error'); return; }

    const success = await editorApi.exportAmiga({
      projectFolder: currentFolder,
      iffData: iffData ? Array.from(iffData) : [],
      iffBitplanes: bp,
      mapsAb3Data: Array.from(mapsAb3Bytes),
      gameAb3Data: Array.from(gameAb3Bytes)
    });

    if (success) showToast(`Exported to amiga/ in ${currentFolder}`, 'success');
    else showToast('Export failed', 'error');
  }

  if (exportBtn) exportBtn.addEventListener('click', doTiledExport);
  if (!browseBtn || !canvas) return;

  browseBtn.addEventListener('click', async () => {
    const folder = await editorApi.pickFolder();
    if (!folder) return;
    currentFolder = folder;
    pathEl.textContent = folder;

    const list = await editorApi.listDirectory(folder);
    if (!list) return;

    const jsonFiles = list.files.filter((f: string) => f.toLowerCase().endsWith('.json'));
    const pngFiles = list.files.filter((f: string) => f.toLowerCase().endsWith('.png'));

    if (jsonFiles.length === 0) {
      pathEl.textContent = folder + ' (no .json files found)';
      return;
    }

    mapList = jsonFiles.map((f: string) => ({
      name: f,
      jsonPath: folder + '/' + f,
    }));

    pngPath = pngFiles.find((p: string) =>
      jsonFiles.some((j: string) => p.replace(/\.png$/i, '') === j.replace(/\.json$/i, ''))
    ) || pngFiles[0] || '';
    if (pngPath) pngPath = folder + '/' + pngPath;

    mapsEl.innerHTML = mapList.map((m, i) =>
      `<button class="tiled-map-btn" style="background:#0f3460;color:#e0e0e0;border:1px solid #1a508b;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;" data-idx="${i}">${m.name}</button>`
    ).join('');

    mapsEl.querySelectorAll('.tiled-map-btn').forEach(btn => {
      btn.addEventListener('click', () => loadMap(parseInt((btn as HTMLElement).dataset.idx!)));
    });

    if (mapList.length) await loadMap(0);
  });

  async function loadMap(idx: number) {
    if (idx < 0 || idx >= mapList.length) return;
    currentMapIdx = idx;
    fileEl.textContent = mapList[idx].name;

    mapsEl.querySelectorAll('.tiled-map-btn').forEach((b, i) => {
      (b as HTMLElement).style.background = i === idx ? '#e94560' : '#0f3460';
      (b as HTMLElement).style.color = i === idx ? '#fff' : '#e0e0e0';
    });

    const metaRaw = await editorApi.readTextFile(mapList[idx].jsonPath);
    if (!metaRaw) {
      document.getElementById('tiled-status')!.textContent = 'ERROR: Cannot read JSON';
      return;
    }
    const mapJson = JSON.parse(metaRaw);

    // Inject tile properties from external .tsx tilesets into the JSON
    if (mapJson.tilesets) {
      for (const ts of mapJson.tilesets) {
        if (ts.source && !ts.tiles) {
          try {
            const tsxRaw = await editorApi.readTextFile(currentFolder + '/' + ts.source);
            if (tsxRaw) {
              // Parse tile properties from TSX XML
              const tileRegex = /<tile\s+id="(\d+)"[^>]*>([\s\S]*?)<\/tile>/g;
              const tiles: Record<string, any> = {};
              let match;
              while ((match = tileRegex.exec(tsxRaw)) !== null) {
                const tileId = match[1];
                const inner = match[2];
                const propsRegex = /<property\s+name="([^"]*)"\s+type="([^"]*)"[^>]*\s+value="([^"]*)"/g;
                const properties: any[] = [];
                let propMatch;
                while ((propMatch = propsRegex.exec(inner)) !== null) {
                  properties.push({
                    name: propMatch[1],
                    type: propMatch[2],
                    value: parseInt(propMatch[3], 10)
                  });
                }
                if (properties.length > 0) {
                  tiles[tileId] = { properties };
                }
              }
              if (Object.keys(tiles).length > 0) {
                ts.tiles = tiles;
              }
              // Extract image dimensions from TSX
              const imgMatch = tsxRaw.match(/<image\s+source="([^"]+)"\s+width="(\d+)"\s+height="(\d+)"/);
              if (imgMatch) {
                ts.imagewidth = parseInt(imgMatch[2], 10);
                ts.imageheight = parseInt(imgMatch[3], 10);
              }
            }
          } catch {}
        }
      }
    }

    if (!pngPath) {
      const ts = mapJson.tilesets?.[0];
      if (ts?.image) {
        pngPath = currentFolder + '/' + ts.image;
      } else if (ts?.source) {
        try {
          const tsxRaw = await editorApi.readTextFile(currentFolder + '/' + ts.source);
          if (tsxRaw) {
            const m = tsxRaw.match(/<image\s+source="([^"]+)"/);
            if (m) {
              const tsxFolder = (currentFolder + '/' + ts.source).replace(/\/[^/]+$/, '');
              pngPath = tsxFolder + '/' + m[1];
            }
          }
        } catch {}
      }
      if (!pngPath) {
        document.getElementById('tiled-status')!.textContent = 'ERROR: No PNG tilesheet found';
        return;
      }
    }

    if ((window as any).renderTiledMap) {
      await (window as any).renderTiledMap(mapJson, pngPath, canvas);
      if (exportBtn) exportBtn.disabled = false;
      // Setup tilesheet IFF link after render
      setupTiledIffLink();
    }
  }

  // ─── Tilesheet IFF link ──────────────────────────────────────────────

  function getTilesheetImage(): HTMLImageElement | null {
    const exportData = (window as any).tiledGetExportData?.();
    if (!exportData || !exportData.tilesheet) return null;
    return exportData.tilesheet;
  }

  function updateTiledIffPreview(img: HTMLImageElement, bp: number): void {
    const result = buildIffFromImage(img, bp);
    tiledIffLastResult = result;

    // Update hover popup preview
    const popupCanvas = document.getElementById('tiled-tilesheet-iff-preview') as HTMLCanvasElement;
    if (popupCanvas && result.palette && result.indexMap) {
      const w = img.width, h = img.height;
      popupCanvas.width = w;
      popupCanvas.height = h;
      const ctx = popupCanvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const imageData = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = result.indexMap[y * w + x];
          const colOff = idx * 3;
          const pxOff = (y * w + x) * 4;
          imageData.data[pxOff] = result.palette[colOff];
          imageData.data[pxOff + 1] = result.palette[colOff + 1];
          imageData.data[pxOff + 2] = result.palette[colOff + 2];
          imageData.data[pxOff + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }

  function setupTiledIffLink(): void {
    const img = getTilesheetImage();
    if (!img) return;

    tiledTilesheetImage = img;

    // Show the tilesheet IFF section
    const iffSection = document.getElementById('tiled-tilesheet-iff')!;
    iffSection.style.display = 'block';

    // Update hover preview
    updateTiledIffPreview(img, tiledIffBitplanes);

    // Update link text to show current setting, then wire click handler
    const trigger = document.getElementById('tiled-tilesheet-iff-trigger')!;
    trigger.textContent = `Tilesheet IFF (${tiledIffBitplanes}bp / ${1 << tiledIffBitplanes} colors)`;
    const newTrigger = trigger.cloneNode(true) as HTMLElement;
    trigger.parentNode!.replaceChild(newTrigger, trigger);
    newTrigger.addEventListener('click', () => openTiledIffModal());

    // Setup modal if not done yet
    setupTiledIffModal();
  }

  function openTiledIffModal(): void {
    const modal = document.getElementById('tiled-iff-modal')!;
    modal.classList.remove('hidden');

    const img = tiledTilesheetImage;
    if (!img) return;

    const bpSlider = document.getElementById('tiled-iff-modal-bitplanes') as HTMLInputElement;
    bpSlider.value = String(tiledIffBitplanes);
    updateTiledIffModalPreview(img, tiledIffBitplanes);
  }

  function updateTiledIffModalPreview(img: HTMLImageElement, bp: number): void {
    const result = buildIffFromImage(img, bp);
    tiledIffLastResult = result;

    // original canvas (native resolution)
    const origCanvas = document.getElementById('tiled-iff-modal-orig-canvas') as HTMLCanvasElement;
    origCanvas.width = img.width;
    origCanvas.height = img.height;
    const origCtx = origCanvas.getContext('2d')!;
    origCtx.imageSmoothingEnabled = false;
    origCtx.drawImage(img, 0, 0);

    // preview canvas (native resolution)
    const previewCanvas = document.getElementById('tiled-iff-modal-preview-canvas') as HTMLCanvasElement;
    previewCanvas.width = img.width;
    previewCanvas.height = img.height;
    const prevCtx = previewCanvas.getContext('2d')!;
    prevCtx.imageSmoothingEnabled = false;
    const imageData = prevCtx.createImageData(img.width, img.height);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const idx = result.indexMap[y * img.width + x];
        const colOff = idx * 3;
        const pxOff = (y * img.width + x) * 4;
        imageData.data[pxOff] = result.palette[colOff];
        imageData.data[pxOff + 1] = result.palette[colOff + 1];
        imageData.data[pxOff + 2] = result.palette[colOff + 2];
        imageData.data[pxOff + 3] = 255;
      }
    }
    prevCtx.putImageData(imageData, 0, 0);

    // update labels
    const colors = 1 << bp;
    document.getElementById('tiled-iff-modal-bp-label')!.textContent = String(bp);
    document.getElementById('tiled-iff-modal-colors-label')!.textContent = `${colors} color${bp !== 1 ? 's' : ''}`;
    document.getElementById('tiled-iff-modal-cmap-info')!.textContent = `${colors} color${bp !== 1 ? 's' : ''}`;

    // update palette swatches
    const swatchesEl = document.getElementById('tiled-iff-modal-palette-swatches')!;
    let html = '';
    for (let i = 0; i < colors; i++) {
      const off = i * 3;
      const r = result.palette[off], g = result.palette[off + 1], b = result.palette[off + 2];
      html += `<span class="conv-swatch" style="background:rgb(${r},${g},${b})" title="#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}"></span>`;
    }
    swatchesEl.innerHTML = html;
  }

  let tiledIffModalSetupDone = false;
  function setupTiledIffModal(): void {
    if (tiledIffModalSetupDone) return;
    tiledIffModalSetupDone = true;

    const modal = document.getElementById('tiled-iff-modal')!;
    const bpSlider = document.getElementById('tiled-iff-modal-bitplanes') as HTMLInputElement;
    const cancelBtn = document.getElementById('tiled-iff-modal-cancel') as HTMLButtonElement;
    const saveBtn = document.getElementById('tiled-iff-modal-save') as HTMLButtonElement;

    bpSlider.addEventListener('input', () => {
      const bp = parseInt(bpSlider.value);
      if (tiledTilesheetImage) {
        updateTiledIffModalPreview(tiledTilesheetImage, bp);
      }
    });

    cancelBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    saveBtn.addEventListener('click', () => {
      tiledIffBitplanes = parseInt(bpSlider.value);
      // Update the hover popup and link text
      if (tiledTilesheetImage) {
        updateTiledIffPreview(tiledTilesheetImage, tiledIffBitplanes);
      }
      const trigger = document.getElementById('tiled-tilesheet-iff-trigger');
      if (trigger) trigger.textContent = `Tilesheet IFF (${tiledIffBitplanes}bp / ${1 << tiledIffBitplanes} colors)`;
      modal.classList.add('hidden');
      showToast(`IFF bitplanes set to ${tiledIffBitplanes} (${1 << tiledIffBitplanes} colors)`, 'success');
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
}

// ─── PNG → IFF CONVERTER ───────────────────────────────────────────────────

let convPngDataUrl: string | null = null;
let convPngFileName: string = '';
let convIffBytes: Uint8Array | null = null;
let convPalette: Uint8Array | null = null;
let convIndexMap: Uint8Array | null = null;
let convImgWidth = 0;
let convImgHeight = 0;
let convBitplanes = 4;
let convLoadedImg: HTMLImageElement | null = null;

const btnPickPngConv = document.getElementById('btn-pick-png-conv') as HTMLButtonElement;
const pngFileNameConv = document.getElementById('png-file-name-conv') as HTMLSpanElement;
const convPngCanvas = document.getElementById('conv-png-canvas') as HTMLCanvasElement;
const convIffCanvas = document.getElementById('conv-iff-canvas') as HTMLCanvasElement;
const convPreviewRow = document.getElementById('conv-png-preview-row')!;
const convFileInfo = document.getElementById('conv-file-info')!;
const convPngDim = document.getElementById('conv-png-dim') as HTMLSpanElement;
const convIffSize = document.getElementById('conv-iff-size') as HTMLSpanElement;
const convIffColors = document.getElementById('conv-iff-colors') as HTMLSpanElement;
const convBpSlider = document.getElementById('conv-bitplanes') as HTMLInputElement;
const convBpLabel = document.getElementById('conv-bp-label') as HTMLElement;
const convColorsLabel = document.getElementById('conv-colors-label') as HTMLElement;
const convPaletteDiv = document.getElementById('conv-palette')!;
const convPaletteSwatches = document.getElementById('conv-palette-swatches')!;
const btnConvertIff = document.getElementById('btn-convert-iff') as HTMLButtonElement;

convBpSlider.addEventListener('input', () => {
  convBitplanes = parseInt(convBpSlider.value);
  const colors = 1 << convBitplanes;
  convBpLabel.textContent = String(convBitplanes);
  convColorsLabel.textContent = `${colors} color${convBitplanes !== 1 ? 's' : ''}`;
  if (convLoadedImg) reconvert();
});

btnPickPngConv.addEventListener('click', async () => {
  const result = await editorApi.pickPng();
  if (!result) return;
  convPngDataUrl = result.dataUrl;
  convPngFileName = result.fileName;
  pngFileNameConv.textContent = result.fileName;
  const img = new Image();
  img.onload = () => {
    convLoadedImg = img;
    convPngCanvas.width = img.width;
    convPngCanvas.height = img.height;
    const ctx = convPngCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    convPngDim.textContent = `${img.width}\u00d7${img.height} px`;
    convImgWidth = img.width;
    convImgHeight = img.height;
    reconvert();
    convPreviewRow.style.display = 'flex';
    convFileInfo.style.display = 'flex';
    btnConvertIff.disabled = false;
  };
  img.src = result.dataUrl;
});

function reconvert(): void {
  if (!convLoadedImg) return;
  const bp = parseInt(convBpSlider.value);
  const result = buildIffFromImage(convLoadedImg, bp);
  convIffBytes = result.iff;
  convPalette = result.palette;
  convIndexMap = result.indexMap;

  drawIffPreview(convPalette, convIndexMap);
  drawPaletteSwatches(convPalette, bp);
  convIffSize.textContent = formatSize(convIffBytes.length);
  convIffColors.textContent = `${1 << bp} colors`;
  convPaletteDiv.style.display = 'block';
}

function drawIffPreview(palette: Uint8Array, indexMap: Uint8Array): void {
  const w = convImgWidth, h = convImgHeight;
  convIffCanvas.width = w; convIffCanvas.height = h;
  const iffCtx = convIffCanvas.getContext('2d')!;
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

function drawPaletteSwatches(palette: Uint8Array, nPlanes: number): void {
  const numColors = 1 << nPlanes;
  let html = '';
  for (let i = 0; i < numColors; i++) {
    const off = i * 3;
    const r = palette[off], g = palette[off + 1], b = palette[off + 2];
    html += `<span class="conv-swatch" style="background:rgb(${r},${g},${b})" title="#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}"></span>`;
  }
  convPaletteSwatches.innerHTML = html;
}

btnConvertIff.addEventListener('click', async () => {
  if (!convIffBytes) { showToast('No IFF data to save', 'error'); return; }
  const defaultName = convPngFileName.replace(/\.png$/i, '.iff') || 'output.iff';
  const savePath = await editorApi.saveIffDialog(defaultName);
  if (!savePath) return;
  const success = await editorApi.writeFile(savePath, Array.from(convIffBytes));
  if (success) showToast('IFF saved: ' + savePath, 'success');
  else showToast('Failed to save IFF', 'error');
});

// ─── BOOT ─────────────────────────────────────────────────────────────────

switchTab('tiled-viewer');
// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Constants that define the editor grid, tile sheet, and rendering scale. */
interface EditorConfig {
  readonly tileSize: number;      // source tile size in pixels
  readonly scale: number;         // display scale factor
  readonly dTile: number;         // display tile size (tileSize * scale)
  readonly tilesheetCols: number;
  readonly tilesheetRows: number;
  readonly mapCols: number;
  readonly mapRows: number;
  readonly mapW: number;          // logical map width  (mapCols * tileSize)
  readonly mapH: number;          // logical map height (mapRows * tileSize)
  readonly sheetW: number;        // logical sheet width  (tilesheetCols * tileSize)
  readonly sheetH: number;        // logical sheet height (tilesheetRows * tileSize)
}

/** A tile coordinate (row / column) on either the map or the tile sheet. */
interface TileCoord {
  col: number;
  row: number;
}

/** Raw unscaled canvas coordinates from a mouse event. */
interface CanvasPoint {
  x: number;
  y: number;
}

/** The export schema written by the "Export Map Data" button. */
interface ExportData {
  cols: number;
  rows: number;
  tiles: number[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE_SIZE = 16;
const SCALE = 2;
const DTILE = TILE_SIZE * SCALE;

const TILESHEET_COLS = 20;
const TILESHEET_ROWS = 20;
const MAP_COLS = 20;
const MAP_ROWS = 16;

const MAP_W = MAP_COLS * TILE_SIZE;
const MAP_H = MAP_ROWS * TILE_SIZE;
const SHEET_W = TILESHEET_COLS * TILE_SIZE;
const SHEET_H = TILESHEET_ROWS * TILE_SIZE;

const CONFIG: EditorConfig = {
  tileSize: TILE_SIZE,
  scale: SCALE,
  dTile: DTILE,
  tilesheetCols: TILESHEET_COLS,
  tilesheetRows: TILESHEET_ROWS,
  mapCols: MAP_COLS,
  mapRows: MAP_ROWS,
  mapW: MAP_W,
  mapH: MAP_H,
  sheetW: SHEET_W,
  sheetH: SHEET_H,
};

// ─── DOM elements ─────────────────────────────────────────────────────────────

const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const mapCtx = mapCanvas.getContext('2d')!;
const tilesCanvas = document.getElementById('tiles-canvas') as HTMLCanvasElement;
const tilesCtx = tilesCanvas.getContext('2d')!;
const activeTileSpan = document.getElementById('active-tile-id') as HTMLSpanElement;

// ─── State ────────────────────────────────────────────────────────────────────

const map: number[][] = [];
let activeTile = 0;
let mouseDown = false;
let lastPlaced: string | null = null;

let sheetHover: TileCoord = { col: -1, row: -1 };
let mapHover: TileCoord = { col: -1, row: -1 };

// ─── Init map grid ────────────────────────────────────────────────────────────

function initMap(): void {
  for (let r = 0; r < CONFIG.mapRows; r++) {
    map[r] = new Array(CONFIG.mapCols).fill(0);
  }
}
initMap();

// ─── Canvas sizes ─────────────────────────────────────────────────────────────

mapCanvas.width = CONFIG.mapW * CONFIG.scale;
mapCanvas.height = CONFIG.mapH * CONFIG.scale;
tilesCanvas.width = CONFIG.sheetW * CONFIG.scale;
tilesCanvas.height = CONFIG.sheetH * CONFIG.scale;

// ─── Load tilesheet ───────────────────────────────────────────────────────────

const tilesheet = new Image();
tilesheet.src = 'assets/monochrome_tilemap_packed.png';

// ─── DRAWING ──────────────────────────────────────────────────────────────────

/** Convert a 1‑D tile index into its source (sx, sy) position in the tilesheet. */
function tileSourceXY(tileIdx: number): { sx: number; sy: number } {
  const sx = (tileIdx % CONFIG.tilesheetCols) * CONFIG.tileSize;
  const sy = Math.floor(tileIdx / CONFIG.tilesheetCols) * CONFIG.tileSize;
  return { sx, sy };
}

/** Convert a 1‑D tile index into its display (sx, sy) position (scaled). */
function tileDisplayXY(tileIdx: number): { sx: number; sy: number } {
  const base = tileSourceXY(tileIdx);
  return { sx: base.sx * CONFIG.scale, sy: base.sy * CONFIG.scale };
}

function drawMap(): void {
  mapCtx.clearRect(0, 0, CONFIG.mapW * CONFIG.scale, CONFIG.mapH * CONFIG.scale);
  for (let r = 0; r < CONFIG.mapRows; r++) {
    for (let c = 0; c < CONFIG.mapCols; c++) {
      const tileIdx = map[r][c];
      const { sx, sy } = tileSourceXY(tileIdx);
      mapCtx.drawImage(
        tilesheet,
        sx, sy,
        CONFIG.tileSize, CONFIG.tileSize,
        c * CONFIG.dTile, r * CONFIG.dTile,
        CONFIG.dTile, CONFIG.dTile
      );
    }
  }
  drawMapGrid();
  drawMapGhost();
}

function drawMapGhost(): void {
  if (mapHover.col < 0 || mapHover.row < 0) return;
  const { sx, sy } = tileSourceXY(activeTile);
  mapCtx.globalAlpha = 0.5;
  mapCtx.drawImage(
    tilesheet,
    sx, sy,
    CONFIG.tileSize, CONFIG.tileSize,
    mapHover.col * CONFIG.dTile,
    mapHover.row * CONFIG.dTile,
    CONFIG.dTile, CONFIG.dTile
  );
  mapCtx.globalAlpha = 1.0;

  // Bright outline on the ghost cell
  mapCtx.strokeStyle = '#ffd700';
  mapCtx.lineWidth = 2;
  mapCtx.strokeRect(
    mapHover.col * CONFIG.dTile + 0.5,
    mapHover.row * CONFIG.dTile + 0.5,
    CONFIG.dTile - 1,
    CONFIG.dTile - 1
  );
}

function drawMapGrid(): void {
  mapCtx.strokeStyle = 'rgba(233, 69, 96, 0.35)';
  mapCtx.lineWidth = 1;
  const dispW = CONFIG.mapW * CONFIG.scale;
  const dispH = CONFIG.mapH * CONFIG.scale;
  for (let x = 0; x <= dispW; x += CONFIG.dTile) {
    mapCtx.beginPath();
    mapCtx.moveTo(x, 0);
    mapCtx.lineTo(x, dispH);
    mapCtx.stroke();
  }
  for (let y = 0; y <= dispH; y += CONFIG.dTile) {
    mapCtx.beginPath();
    mapCtx.moveTo(0, y);
    mapCtx.lineTo(dispW, y);
    mapCtx.stroke();
  }
}

function drawTilesheet(): void {
  tilesCtx.drawImage(
    tilesheet,
    0, 0,
    CONFIG.sheetW, CONFIG.sheetH,
    0, 0,
    CONFIG.sheetW * CONFIG.scale,
    CONFIG.sheetH * CONFIG.scale
  );
  drawTilesheetGrid();
  drawSheetHover();
  drawActiveHighlight();
}

function drawSheetHover(): void {
  if (sheetHover.col < 0 || sheetHover.row < 0) return;
  const sx = sheetHover.col * CONFIG.dTile;
  const sy = sheetHover.row * CONFIG.dTile;
  tilesCtx.strokeStyle = '#ffd700';
  tilesCtx.lineWidth = 2;
  tilesCtx.strokeRect(sx + 0.5, sy + 0.5, CONFIG.dTile - 1, CONFIG.dTile - 1);
}

function drawTilesheetGrid(): void {
  tilesCtx.strokeStyle = 'rgba(15, 52, 96, 0.7)';
  tilesCtx.lineWidth = 1;
  const dispW = CONFIG.sheetW * CONFIG.scale;
  const dispH = CONFIG.sheetH * CONFIG.scale;
  for (let x = 0; x <= dispW; x += CONFIG.dTile) {
    tilesCtx.beginPath();
    tilesCtx.moveTo(x, 0);
    tilesCtx.lineTo(x, dispH);
    tilesCtx.stroke();
  }
  for (let y = 0; y <= dispH; y += CONFIG.dTile) {
    tilesCtx.beginPath();
    tilesCtx.moveTo(0, y);
    tilesCtx.lineTo(dispW, y);
    tilesCtx.stroke();
  }
}

function drawActiveHighlight(): void {
  const { sx, sy } = tileDisplayXY(activeTile);
  tilesCtx.strokeStyle = '#e94560';
  tilesCtx.lineWidth = 2.5;
  tilesCtx.strokeRect(sx + 1, sy + 1, CONFIG.dTile - 2, CONFIG.dTile - 2);
}

// ─── Active‑tile display ──────────────────────────────────────────────────────

function updateActiveDisplay(): void {
  const col = activeTile % CONFIG.tilesheetCols;
  const row = Math.floor(activeTile / CONFIG.tilesheetCols);
  activeTileSpan.textContent = `${activeTile} (${col},${row})`;
}

// ─── Tile‑index helpers ───────────────────────────────────────────────────────

/** Given a tile's column / row, return its flat index in the sheet. */
function tileIndexFromCoord(col: number, row: number): number {
  return row * CONFIG.tilesheetCols + col;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Convert mouse event to unscaled canvas pixel coordinates. */
function canvasCoords(e: MouseEvent, canvas: HTMLCanvasElement): CanvasPoint {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

/** Convert a canvas pixel position into a cell coordinate. */
function cellFromPoint(p: CanvasPoint): TileCoord {
  return {
    col: Math.floor(p.x / CONFIG.dTile),
    row: Math.floor(p.y / CONFIG.dTile)
  };
}

/** Check whether a cell coordinate lies within a given grid. */
function isCellInBounds(
  coord: TileCoord,
  cols: number,
  rows: number
): boolean {
  return coord.col >= 0 && coord.col < cols && coord.row >= 0 && coord.row < rows;
}

// ─── Map editing ──────────────────────────────────────────────────────────────

function placeTileOnMap(p: CanvasPoint): void {
  const cell = cellFromPoint(p);
  if (!isCellInBounds(cell, CONFIG.mapCols, CONFIG.mapRows)) return;

  const key = `${cell.row},${cell.col}`;
  if (key === lastPlaced) return;
  lastPlaced = key;

  map[cell.row][cell.col] = activeTile;
  drawMap();
}

// ─── EVENT HANDLERS ───────────────────────────────────────────────────────────

tilesCanvas.addEventListener('mousedown', (e: MouseEvent) => {
  const p = canvasCoords(e, tilesCanvas);
  const cell = cellFromPoint(p);

  if (isCellInBounds(cell, CONFIG.tilesheetCols, CONFIG.tilesheetRows)) {
    activeTile = tileIndexFromCoord(cell.col, cell.row);
    updateActiveDisplay();
    drawTilesheet();
  }
});

tilesCanvas.addEventListener('mousemove', (e: MouseEvent) => {
  const p = canvasCoords(e, tilesCanvas);
  const cell = cellFromPoint(p);

  if (isCellInBounds(cell, CONFIG.tilesheetCols, CONFIG.tilesheetRows)) {
    sheetHover = cell;
  } else {
    sheetHover = { col: -1, row: -1 };
  }
  drawTilesheet();
});

tilesCanvas.addEventListener('mouseleave', () => {
  sheetHover = { col: -1, row: -1 };
  drawTilesheet();
});

mapCanvas.addEventListener('mousedown', (e: MouseEvent) => {
  mouseDown = true;
  lastPlaced = null;
  placeTileOnMap(canvasCoords(e, mapCanvas));
});

window.addEventListener('mouseup', () => {
  mouseDown = false;
  lastPlaced = null;
});

mapCanvas.addEventListener('mousemove', (e: MouseEvent) => {
  const p = canvasCoords(e, mapCanvas);
  const cell = cellFromPoint(p);

  if (isCellInBounds(cell, CONFIG.mapCols, CONFIG.mapRows)) {
    mapHover = cell;
  } else {
    mapHover = { col: -1, row: -1 };
  }

  if (mouseDown) {
    placeTileOnMap(p);
  } else {
    drawMap();
  }
});

mapCanvas.addEventListener('mouseleave', () => {
  mapHover = { col: -1, row: -1 };
  drawMap();
});

// Prevent right‑click on canvases
[mapCanvas, tilesCanvas].forEach((c) => {
  c.addEventListener('contextmenu', (e: Event) => e.preventDefault());
});

// ─── BUTTONS ──────────────────────────────────────────────────────────────────

document.getElementById('btn-clear')!.addEventListener('click', () => {
  for (let r = 0; r < CONFIG.mapRows; r++) {
    for (let c = 0; c < CONFIG.mapCols; c++) {
      map[r][c] = 0;
    }
  }
  drawMap();
});

document.getElementById('btn-fill')!.addEventListener('click', () => {
  for (let r = 0; r < CONFIG.mapRows; r++) {
    for (let c = 0; c < CONFIG.mapCols; c++) {
      map[r][c] = activeTile;
    }
  }
  drawMap();
});

document.getElementById('btn-export')!.addEventListener('click', () => {
  const flat: number[] = [];
  for (let r = 0; r < CONFIG.mapRows; r++) {
    flat.push(...map[r]);
  }

  const data: ExportData = {
    cols: CONFIG.mapCols,
    rows: CONFIG.mapRows,
    tiles: flat
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'platformer_map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ─── INITIAL RENDER ───────────────────────────────────────────────────────────

tilesheet.onload = () => {
  drawTilesheet();
  drawMap();
  updateActiveDisplay();
};
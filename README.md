# Tiled2Retro

Convert Tiled maps to AmiBlitz3 source code (.ab3) with IFF/ILBM tilesheet export. Built with Electron + TypeScript.

## Features

- **Tiled JSON map viewer** — browse a folder with Tiled .json map files + PNG tilesheet, preview the rendered map
- **Multi-bitplane IFF export** — select 1-8 bitplanes (2-256 colors), tilesheet is color-quantized and exported as standard ILBM
- **AmiBlitz3 code generation** — generates two .ab3 files:
  - `game.ab3` — full game loop with hardware sprite, joystick control, ladder climbing, and collision detection
  - `mapdata.ab3` — tile map data and tile flags (`.MapData` + `.FlagData`), can be included via `XINCLUDE`
- **PNG -> IFF converter tab** — load any PNG, quantize to a chosen bit depth, preview palette and converted image, and save as `.iff`/`.ilbm`

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Install & Run

```bash
npm install
npm run compile    # compile TypeScript
npm start          # launch the Electron app
```

## Usage

### Tiled Viewer Tab

1. Click **Browse...** and select a folder containing:
   - One or more Tiled `.json` map files (level1.json, level2.json, ...)
   - A `.tsx` tileset file referencing tile properties (FLOOR, WALL, LADDER flags)
   - A PNG tilesheet (referenced in the tileset or matching filename)
2. The map renders in the canvas. Click map names to switch between maps.
3. Click the **Tilesheet IFF** link to configure bitplanes (1-8).
4. Click **Export Amiga** to generate files in an `amiga/` subfolder:

| File | Description |
|---|---|
| `tiles_Xbp.iff` | Multi-bitplane ILBM tilesheet |
| `game.ab3` | Full game loop: loads IFF, builds tile map, extracts sprite (tile 459), joystick movement with collision detection |
| `mapdata.ab3` | Tile map data + tile flags for each level (numbered: `.MapData1`, `.FlagData1`, etc.) |

The exported `.ab3` files are **plain ASCII** with LF line endings (Unix-style). No non-ASCII characters are present — safe for AmiBlitz import.

### Game Features (game.ab3)

- **Hardware sprite** player (tile 459 from the tilesheet, extracted as sprite channel 0)
- **Joystick control**: left/right movement, jumping, ladder climbing
- **Collision detection**: WALL tiles block movement, FLOOR tiles support walking/landing, LADDER tiles allow climbing
- **State machine**: Walking, Climbing, Jumping, Falling states with proper transitions
- **Single level**: loads map data and tile flags from inline `.MapData` / `.FlagData` labels

### Map Data (mapdata.ab3)

`mapdata.ab3` contains the raw tile indices and flag data for each level:

```
.MapData1:
Data.w ...
.FlagData1:
Data.w ...
.MapData2:
Data.w ...
.FlagData2:
Data.w ...
```

This file can be included in `game.ab3` via `XINCLUDE "mapdata.ab3"` (placed after `End`) for manual multi-level setups. Each `.MapDataN` label stores the tile index for each cell; `.FlagDataN` stores the combined collision flags (FLOOR=1, WALL=2, LADDER=4).

### Loading in AmiBlitz

| AmiBlitz Version | ASCII `.ab3` | Tokenized `.ab3` |
|---|---|---|
| **3.10** | Works via "Open" | Works |
| **3.13b** | "Library not Available" runtime error | Works |

AmiBlitz 3.13b does not properly handle ASCII `.ab3` files when opened directly — it triggers a runtime error on library calls like `LoadBitMap`. To use in 3.13b:

1. Open the generated `game.ab3` in **AmiBlitz 3.10**
2. **Compile & Save** — this converts it to the tokenized binary `.ab3` format
3. Open the saved tokenized file in **AmiBlitz 3.13b**

Alternatively, run the project directly in AmiBlitz 3.10 from the start.

### PNG -> IFF Converter Tab

1. Pick any PNG file
2. Adjust the bitplanes slider (1-8)
3. Preview the color-quantized result and palette
4. Click **Convert & Save IFF** to write the IFF/ILBM file

## IFF/ILBM Format

Exported IFF files use standard ILBM with:
- **BMHD** chunk — image dimensions, bitplane depth (1-8)
- **CMAP** chunk — palette (3 bytes per color, 2^n entries)
- **BODY** chunk — interleaved bitplane data (plane-by-plane per scanline)

Compression is not used (uncompressed BODY).

## Tile Properties

The `.tsx` tileset file can define custom properties on each tile. The export uses the `FLAGS` property as a bitmask:

| Flag | Value | Description |
|---|---|---|
| FLOOR | 1 | Standing/walking surface |
| WALL | 2 | Impassable block (stops horizontal movement) |
| LADDER | 4 | Climbable surface |

Tiles with multiple flags combine values (e.g., FLOOR+LADDER=5).

## Project Structure

```
tiled2retro/
├── index.html           # Main window HTML
├── style.css            # UI styles
├── src/
│   ├── main.ts          # Electron main process (IPC handlers, file I/O)
│   ├── preload.ts       # Context bridge API exposed to renderer
│   ├── renderer.ts      # Map viewer, IFF builder, AB3 code generation
│   ├── tiled-viewer.ts  # Tiled map rendering on canvas
│   └── tiled-viewer-vanilla.ts  # Vanilla JS alternative renderer
├── assets/
│   ├── jszip.min.js     # JSZip (loaded via script tag)
│   └── monochrome_tilemap_packed.iff  # Sample 1-bitplane tilesheet
├── blitzbasic_manuals/  # BlitzBasic/AmiBlitz reference docs
├── scripts/             # Helper scripts (e.g. png_to_iff.py)
├── .clinerules          # AmiBlitz3 code-generation guidelines
├── package.json
└── tsconfig.json
```

## License

MIT
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    tileSize: 16,
    scale: 2,
    tilesheetCols: 20,
    tilesheetRows: 20,
    mapCols: 20,
    mapRows: 16
};
electron_1.contextBridge.exposeInMainWorld('platformer', api);
//# sourceMappingURL=preload.js.map
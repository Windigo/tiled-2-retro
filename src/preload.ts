import { contextBridge } from 'electron';

interface PlatformerAPI {
  tileSize: number;
  scale: number;
  tilesheetCols: number;
  tilesheetRows: number;
  mapCols: number;
  mapRows: number;
}

const api: PlatformerAPI = {
  tileSize: 16,
  scale: 2,
  tilesheetCols: 20,
  tilesheetRows: 20,
  mapCols: 20,
  mapRows: 16
};

contextBridge.exposeInMainWorld('platformer', api);
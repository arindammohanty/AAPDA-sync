import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { initializeFallbackDb, syncToIndexedDB } from '../storage/fallback';
import type { FeatureCollection, LineString } from 'geojson';

let db: any = null;
let sqlite3Ref: any = null;
let isFallback = false;

// Pseudo-random elevation generator (migrated from pathfinding)
function getElevation(lon: number, lat: number): number {
  const dx = (lon - 85.8) * 100;
  const dy = (lat - 20.3) * 100;
  const elevation = 45 + Math.sin(dx * 5) * 20 + Math.cos(dy * 5) * 20 - Math.sin((dx+dy)*10)*10;
  return Math.max(0, elevation);
}

function getDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1*rad) * Math.cos(lat2*rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function initDb() {
  try {
    const sqlite3 = await sqlite3InitModule();
    sqlite3Ref = sqlite3;
    
    if ((sqlite3 as any).opfs) {
      db = new (sqlite3 as any).oo1.OpfsDb('/aapdasync.sqlite3');
      console.log('[SQLite OPFS] Mounted resilient storage.');
    } else {
      db = await initializeFallbackDb(sqlite3);
      isFallback = true;
    }
    
    db.exec('PRAGMA journal_mode=WAL;');
    db.exec('PRAGMA synchronous=NORMAL;');
    
    // Initialize Routing Tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS routing_nodes (
        id TEXT PRIMARY KEY,
        lon REAL,
        lat REAL,
        elevation REAL
      );
      CREATE TABLE IF NOT EXISTS routing_edges (
        source TEXT,
        target TEXT,
        weight REAL,
        is_highway BOOLEAN,
        is_flood_risk BOOLEAN,
        PRIMARY KEY (source, target)
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_spatial ON routing_nodes(lon, lat);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON routing_edges(source);
    `);
    
    console.log('[SQLite OPFS] Tactical Routing Schema Initialized.');
    self.postMessage({ type: 'DB_READY' });
  } catch (err) {
    console.error('[SQLite] Failed to initialize:', err);
  }
}

initDb();

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;
  if (!db) return;

  try {
    if (type === 'LOAD_MAP_CHUNK') {
      const geoJson = payload as FeatureCollection<LineString>;
      
      db.exec('BEGIN TRANSACTION;');
      
      let nodeCount = 0;
      let edgeCount = 0;

      geoJson.features.forEach(feature => {
        const coords = feature.geometry.coordinates as [number, number][];
        const highwayType = feature.properties?.highway || 'unknown';
        const isHighway = ['motorway', 'trunk', 'primary'].includes(highwayType);
        
        let multiplier = 1.0;
        if (highwayType === 'motorway' || highwayType === 'trunk') multiplier = 0.5;
        else if (highwayType === 'primary') multiplier = 0.7;
        else if (highwayType === 'secondary') multiplier = 0.9;

        for (let i = 0; i < coords.length; i++) {
          const [lon, lat] = coords[i];
          const nodeId = `${lon},${lat}`;
          
          db.exec({
            sql: 'INSERT OR IGNORE INTO routing_nodes (id, lon, lat, elevation) VALUES (?, ?, ?, ?)',
            bind: [nodeId, lon, lat, getElevation(lon, lat)]
          });
          nodeCount++;

          if (i < coords.length - 1) {
            const [nLon, nLat] = coords[i+1];
            const targetId = `${nLon},${nLat}`;
            
            const dist = getDistance(lon, lat, nLon, nLat);
            const avgElev = (getElevation(lon, lat) + getElevation(nLon, nLat)) / 2;
            const isFloodRisk = avgElev < 12.0;
            
            const finalWeight = dist * multiplier * (isFloodRisk ? 5.0 : 1.0);

            // Undirected graph insertion
            db.exec({
              sql: 'INSERT OR IGNORE INTO routing_edges (source, target, weight, is_highway, is_flood_risk) VALUES (?, ?, ?, ?, ?)',
              bind: [nodeId, targetId, finalWeight, isHighway, isFloodRisk]
            });
            db.exec({
              sql: 'INSERT OR IGNORE INTO routing_edges (source, target, weight, is_highway, is_flood_risk) VALUES (?, ?, ?, ?, ?)',
              bind: [targetId, nodeId, finalWeight, isHighway, isFloodRisk]
            });
            edgeCount++;
          }
        }
      });
      
      db.exec('COMMIT;');
      if (isFallback) syncToIndexedDB(sqlite3Ref, db).catch(console.error);

      console.log(`[SQLite] Ingested map chunk: ${nodeCount} nodes, ${edgeCount} edges`);
      self.postMessage({ type: 'CHUNK_LOADED', payload: { nodeCount, edgeCount } });
      
    } else if (type === 'GET_BBOX_GRAPH') {
      // Massive state-level routing optimization: only pull nodes within bounding box!
      const { minLon, minLat, maxLon, maxLat } = payload;
      
      // Pull nodes in bbox
      const nodesResult = db.exec({
        sql: 'SELECT id, lon, lat FROM routing_nodes WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?',
        bind: [minLon, maxLon, minLat, maxLat],
        returnValue: 'resultRows'
      });
      
      // We will construct the adjacency list to send to the pathfinding worker
      const adjacencyList = new Map();
      
      if (nodesResult && nodesResult.length > 0) {
        // Build an IN clause for the edges query
        const ids = nodesResult.map((row: any) => `'${row[0]}'`).join(',');
        
        const edgesResult = db.exec({
          sql: `SELECT source, target, weight, is_flood_risk FROM routing_edges WHERE source IN (${ids})`,
          returnValue: 'resultRows'
        });

        // Initialize map
        nodesResult.forEach((row: any) => {
          adjacencyList.set(row[0], []);
        });

        if (edgesResult) {
          edgesResult.forEach((row: any) => {
            const [source, target, weight, is_flood_risk] = row;
            // The target might be just outside the bbox, which is fine, we just need the coord
            const targetCoords = target.split(',').map(Number);
            if (adjacencyList.has(source)) {
              adjacencyList.get(source).push({
                node: targetCoords,
                weight: weight,
                isFloodRisk: is_flood_risk === 1
              });
            }
          });
        }
      }
      
      self.postMessage({ type: 'BBOX_GRAPH_RESULT', payload: { adjacencyList: Array.from(adjacencyList.entries()) } });
    }
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Database operation failed:', err);
  }
};

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { initializeFallbackDb, syncToIndexedDB } from '../storage/fallback';
import type { FeatureCollection, LineString } from 'geojson';

let db: any = null;
let sqlite3Ref: any = null;
let isFallback = false;

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
      db = new (sqlite3 as any).oo1.OpfsDb('/aapdasync_v16.sqlite3');
      console.log('[SQLite OPFS] Mounted resilient storage (v16).');
    } else {
      db = await initializeFallbackDb(sqlite3);
      isFallback = true;
    }
    
    // Resilient WASM PRAGMAs: Use FILE temp_store to prevent WASM heap sort OOM during index creation
    db.exec('PRAGMA journal_mode=MEMORY;');
    db.exec('PRAGMA synchronous=OFF;');
    db.exec('PRAGMA temp_store=FILE;');
    db.exec('PRAGMA cache_size = -4000;');
    
    // Drop legacy tables to guarantee clean schema initialization
    db.exec(`
      DROP TABLE IF EXISTS routing_nodes;
      DROP TABLE IF EXISTS routing_edges;
      
      CREATE TABLE routing_nodes (
        id TEXT,
        lon REAL,
        lat REAL,
        elevation REAL
      );
      CREATE TABLE routing_edges (
        source TEXT,
        target TEXT,
        weight REAL,
        is_highway INTEGER,
        is_flood_risk INTEGER
      );
    `);
    
    console.log('[SQLite OPFS] Resilient Routing Schema (v16) Initialized.');
    self.postMessage({ type: 'DB_READY' });
    self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'INFO', category: 'SQLITE_OPFS', message: 'OPFS SQLite storage (v16) initialized successfully.' } });
  } catch (err: any) {
    console.error('[SQLite] Failed to initialize:', err);
    self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'ERROR', category: 'SQLITE_ERROR', message: `DB Init Failure: ${err?.message || String(err)}` } });
  }
}

initDb();

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;
  if (!db) return;

  try {
    if (type === 'LOAD_MAP_CHUNK') {
      const geoJson = payload as FeatureCollection<LineString>;
      
      const processChunk = async () => {
        let nodeCount = 0;
        let edgeCount = 0;
        let featureCount = 0;
        const totalFeatures = geoJson.features.length;

        const insertedNodes = new Set<string>();
        const round6 = (val: number) => Math.round(val * 1e6) / 1e6;

        db.exec('BEGIN TRANSACTION;');

        let stmtNodes = db.prepare('INSERT INTO routing_nodes (id, lon, lat, elevation) VALUES (?, ?, ?, ?)');
        let stmtEdges = db.prepare('INSERT INTO routing_edges (source, target, weight, is_highway, is_flood_risk) VALUES (?, ?, ?, ?, ?)');

        for (const feature of geoJson.features) {
          featureCount++;
          
          if (!feature.geometry || feature.geometry.type !== 'LineString') continue;

          const coords = feature.geometry.coordinates as [number, number][];
          const highwayType = feature.properties?.highway || 'unknown';
          const isHighway = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(highwayType);
          
          let multiplier = 1.0;
          if (highwayType === 'motorway' || highwayType === 'trunk') multiplier = 0.5;
          else if (highwayType === 'primary') multiplier = 0.7;
          else if (highwayType === 'secondary') multiplier = 0.9;

          for (let i = 0; i < coords.length; i++) {
            const [lon, lat] = coords[i];
            const nodeId = `${round6(lon)},${round6(lat)}`;
            
            if (!insertedNodes.has(nodeId)) {
              insertedNodes.add(nodeId);
              stmtNodes.bind([nodeId, lon, lat, getElevation(lon, lat)]);
              stmtNodes.step();
              stmtNodes.reset();
              nodeCount++;
            }

            if (i < coords.length - 1) {
              const [nLon, nLat] = coords[i+1];
              const targetId = `${round6(nLon)},${round6(nLat)}`;
              
              const dist = getDistance(lon, lat, nLon, nLat);
              const isFloodRisk = false; 
              
              const finalWeight = dist * multiplier;

              stmtEdges.bind([nodeId, targetId, finalWeight, isHighway ? 1 : 0, isFloodRisk ? 1 : 0]);
              stmtEdges.step();
              stmtEdges.reset();

              stmtEdges.bind([targetId, nodeId, finalWeight, isHighway ? 1 : 0, isFloodRisk ? 1 : 0]);
              stmtEdges.step();
              stmtEdges.reset();
              
              edgeCount++;
            }
          }

          if (featureCount % 2000 === 0) {
            stmtNodes.finalize();
            stmtEdges.finalize();
            db.exec('COMMIT;');
            
            self.postMessage({ type: 'CHUNK_PROGRESS', payload: { current: featureCount, total: totalFeatures } });
            await new Promise(r => setTimeout(r, 0));
            
            db.exec('BEGIN TRANSACTION;');
            stmtNodes = db.prepare('INSERT INTO routing_nodes (id, lon, lat, elevation) VALUES (?, ?, ?, ?)');
            stmtEdges = db.prepare('INSERT INTO routing_edges (source, target, weight, is_highway, is_flood_risk) VALUES (?, ?, ?, ?, ?)');
          }
        }
        
        stmtNodes.finalize();
        stmtEdges.finalize();
        db.exec('COMMIT;');

        // Build lean spatial B-Tree indices post-ingestion using file temp_store
        console.log('[SQLite OPFS] Indexing spatial bounds post-ingestion...');
        self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'INFO', category: 'SQLITE_OPFS', message: 'Creating spatial B-Tree indices post-ingestion...' } });
        
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_nodes_spatial ON routing_nodes(lon, lat);
          CREATE INDEX IF NOT EXISTS idx_edges_source ON routing_edges(source);
        `);

        if (isFallback) syncToIndexedDB(sqlite3Ref, db).catch(console.error);

        console.log(`[SQLite] Ingested map chunk successfully: ${nodeCount} nodes, ${edgeCount} edges`);
        self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'INFO', category: 'SQLITE_OPFS', message: `Map ingestion completed successfully. Ingested ${nodeCount} nodes, ${edgeCount} edges.` } });
        self.postMessage({ type: 'CHUNK_LOADED', payload: { nodeCount, edgeCount } });
      };
      
      processChunk().catch(err => {
        console.error('Failed processing map chunk:', err);
        self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'ERROR', category: 'SQLITE_INGEST_ERROR', message: `Map Ingestion Failure: ${err?.message || String(err)}` } });
        self.postMessage({ type: 'CHUNK_ERROR', payload: err.message || 'Unknown SQLite Error' });
        try {
          db.exec('ROLLBACK;');
        } catch (e) {
          // Ignore rollback error if no transaction is active
        }
      });
      
    } else if (type === 'GET_BBOX_GRAPH') {
      const { minLon, minLat, maxLon, maxLat } = payload;
      
      const nodesResult = db.exec({
        sql: 'SELECT id, lon, lat FROM routing_nodes WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?',
        bind: [minLon, maxLon, minLat, maxLat],
        returnValue: 'resultRows'
      });
      
      const adjacencyList = new Map();
      
      if (nodesResult && nodesResult.length > 0) {
        const edgesResult = db.exec({
          sql: `SELECT source, target, weight, is_highway, is_flood_risk FROM routing_edges WHERE source IN (SELECT id FROM routing_nodes WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?)`,
          bind: [minLon, maxLon, minLat, maxLat],
          returnValue: 'resultRows'
        });

        nodesResult.forEach((row: any) => {
          adjacencyList.set(row[0], []);
        });

        if (edgesResult) {
          edgesResult.forEach((row: any) => {
            const [source, target, weight, is_highway, is_flood_risk] = row;
            const targetCoords = target.split(',').map(Number);
            if (adjacencyList.has(source)) {
              adjacencyList.get(source).push({
                node: targetCoords,
                weight: weight,
                isHighway: is_highway === 1,
                isFloodRisk: is_flood_risk === 1
              });
            }
          });
        }
      }
      
      self.postMessage({ type: 'BBOX_GRAPH_RESULT', payload: { adjacencyList: Array.from(adjacencyList.entries()) } });
    }
  } catch (err: any) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('Database operation failed:', err);
    self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'ERROR', category: 'SQLITE_ERROR', message: `DB Op Error: ${err?.message || String(err)}` } });
  }
};

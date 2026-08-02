import { PathGraph, getDistance } from './pathfinding';
import type { Coordinate, RouteStats } from './pathfinding';
import { SAFE_ZONES } from './safeZones';

const graph = new PathGraph();
let isBuilt = false;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'BUILD_GRAPH') {
    // Deprecated for massive datasets - use SQLite chunks instead
  } else if (type === 'GRAPH_BUILT') {
    // Receive the parsed subgraph from SQLite OPFS
    graph.adjacencyList = new Map(payload.adjacencyList);
    isBuilt = true;
    console.log(`[Pathfinding Worker] Loaded OPFS chunk with ${graph.adjacencyList.size} nodes for A* execution.`);
  } else if (type === 'CALCULATE_ROUTE') {
    if (!isBuilt) {
      self.postMessage({ type: 'ROUTE_ERROR', payload: 'Graph not built yet' });
      return;
    }

    const { start, target, anomalies = [], breadcrumbs = [], drawnFeatures = { type: 'FeatureCollection', features: [] }, resources = [] } = payload as any;
    
    // Inject any crowd-sourced mesh trails dynamically into the graph before routing
    if (breadcrumbs.length > 0) {
      graph.injectBreadcrumbs(breadcrumbs);
    }
    
    // 1. Calculate Insertion Route (Start -> Target)
    self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'INFO', category: 'PATHFINDER', message: `Executing Bidirectional A* from [${start}] to [${target}]` } });
    self.postMessage({ type: 'ROUTE_PROGRESS', payload: { progress: 35, stage: 'Searching insertion path...' } });

    const insertionRoute = graph.findPath(start, target, anomalies, drawnFeatures, resources, (pct) => {
      self.postMessage({
        type: 'ROUTE_PROGRESS',
        payload: { progress: Math.min(68, Math.round(35 + (pct * 0.33))), stage: 'Searching insertion path...' }
      });
    });
    
    if (!insertionRoute) {
      self.postMessage({ type: 'SYSTEM_LOG', payload: { level: 'WARN', category: 'PATHFINDER', message: 'No continuous road path found between start and target (Graph Isolated).' } });
      self.postMessage({ type: 'ROUTE_ERROR', payload: 'No insertion path found' });
      return;
    }

    // 2. Calculate Extraction Route (Target -> Nearest Safe Zone)
    self.postMessage({ type: 'ROUTE_PROGRESS', payload: { progress: 70, stage: 'Evaluating rescue shelters...' } });

    let bestExtractionRoute: RouteStats | null = null;
    let bestSafeZone = null;
    let minDistance = Infinity;

    const dynamicShelters = drawnFeatures.features
      .filter((f: any) => f.geometry.type === 'Point' && f.properties?.type === 'shelter')
      .map((f: any) => ({
        id: f.properties?.id || Math.random().toString(),
        name: f.properties?.name || 'Field Shelter',
        coordinates: f.geometry.coordinates as Coordinate
      }));

    const allSafeZones = [...SAFE_ZONES, ...dynamicShelters];

    // Sort safe zones by direct haversine distance
    const sortedSafeZones = allSafeZones.sort((a, b) => 
      getDistance(target, a.coordinates) - getDistance(target, b.coordinates)
    );

    // Evaluate closest shelters and pick shortest road route
    for (const safeZone of sortedSafeZones.slice(0, 3)) {
      const route = graph.findPath(target, safeZone.coordinates, anomalies, drawnFeatures, resources, (pct) => {
        self.postMessage({
          type: 'ROUTE_PROGRESS',
          payload: { progress: Math.min(95, Math.round(70 + (pct * 0.25))), stage: `Checking ${safeZone.name}...` }
        });
      });
      if (route && route.totalDistance < minDistance) {
        minDistance = route.totalDistance;
        bestExtractionRoute = route;
        bestSafeZone = safeZone;
      }
    }

    self.postMessage({ 
      type: 'ROUTE_PROGRESS', 
      payload: { progress: 100, stage: 'Route synchronized!' } 
    });

    self.postMessage({ 
      type: 'ROUTE_CALCULATED', 
      payload: { 
        insertionRoute, 
        extractionRoute: bestExtractionRoute,
        safeZone: bestSafeZone
      } 
    });
  }
};

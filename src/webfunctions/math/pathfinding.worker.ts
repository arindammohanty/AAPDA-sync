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

    const { start, target, anomalies = [], breadcrumbs = [] } = payload as { start: Coordinate, target: Coordinate, anomalies?: { coordinates: Coordinate, type: string }[], breadcrumbs?: Coordinate[][] };
    
    // Inject any crowd-sourced mesh trails dynamically into the graph before routing
    if (breadcrumbs.length > 0) {
      graph.injectBreadcrumbs(breadcrumbs);
    }
    
    // 1. Calculate Insertion Route (Start -> Target)
    const insertionRoute = graph.findPath(start, target, anomalies);
    
    if (!insertionRoute) {
      self.postMessage({ type: 'ROUTE_ERROR', payload: 'No insertion path found' });
      return;
    }

    // 2. Calculate Extraction Route (Target -> Nearest Safe Zone)
    let bestExtractionRoute: RouteStats | null = null;
    let bestSafeZone = null;
    let minDistance = Infinity;

    for (const safeZone of SAFE_ZONES) {
      // Very basic optimization: skip A* if haversine distance is already much worse than our best path
      const directDist = getDistance(target, safeZone.coordinates);
      if (bestExtractionRoute && directDist > minDistance * 1.5) continue;

      const route = graph.findPath(target, safeZone.coordinates, anomalies);
      if (route && route.totalDistance < minDistance) {
        minDistance = route.totalDistance;
        bestExtractionRoute = route;
        bestSafeZone = safeZone;
      }
    }

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

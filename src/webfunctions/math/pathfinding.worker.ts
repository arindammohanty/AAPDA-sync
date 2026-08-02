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
    const insertionRoute = graph.findPath(start, target, anomalies, drawnFeatures, resources);
    
    if (!insertionRoute) {
      self.postMessage({ type: 'ROUTE_ERROR', payload: 'No insertion path found' });
      return;
    }

    // 2. Calculate Extraction Route (Target -> Nearest Safe Zone)
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

    // Sort safe zones by direct haversine distance to avoid running A* against every shelter on slow phone CPUs
    const sortedSafeZones = allSafeZones.sort((a, b) => 
      getDistance(target, a.coordinates) - getDistance(target, b.coordinates)
    );

    // Only attempt A* routing to the absolute closest shelter (and the second closest as a fallback)
    for (const safeZone of sortedSafeZones.slice(0, 2)) {
      const route = graph.findPath(target, safeZone.coordinates, anomalies, drawnFeatures, resources);
      if (route && route.totalDistance < minDistance) {
        minDistance = route.totalDistance;
        bestExtractionRoute = route;
        bestSafeZone = safeZone;
        break; // Found the optimal closest route, skip further expensive A* calculations
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

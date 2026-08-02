import type { FeatureCollection, LineString } from 'geojson';

export type Coordinate = [number, number];

// Haversine distance heuristic (in meters)
export function getDistance(coord1: Coordinate, coord2: Coordinate): number {
  const R = 6371e3;
  const lat1 = coord1[1] * Math.PI / 180;
  const lat2 = coord2[1] * Math.PI / 180;
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Pseudo-random elevation generator for air-gapped simulation
// In production, this would sample a local GeoTIFF DEM.
export function getElevation(coord: Coordinate): number {
  const [lon, lat] = coord;
  // Create a deterministic hilly terrain math model centered around Bhubaneswar (85.8, 20.3)
  const dx = (lon - 85.8) * 100;
  const dy = (lat - 20.3) * 100;
  // Base elevation of 45m, dips down to 2m (flood risks) in sinusoidal "river" valleys
  const elevation = 45 + Math.sin(dx * 5) * 20 + Math.cos(dy * 5) * 20 - Math.sin((dx+dy)*10)*10;
  return Math.max(0, elevation);
}

export interface RouteStats {
  path: Coordinate[];
  totalDistance: number;
  travelTimeMinutes: number;
  minElevation: number;
  floodRiskWarnings: number;
}

export function isPointInPolygon(point: Coordinate, polygon: Coordinate[][]): boolean {
  const x = point[0], y = point[1];
  let inside = false;
  if (!polygon[0]) return false;
  for (let i = 0, j = polygon[0].length - 1; i < polygon[0].length; j = i++) {
    const xi = polygon[0][i][0], yi = polygon[0][i][1];
    const xj = polygon[0][j][0], yj = polygon[0][j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export class PathGraph {
  adjacencyList: Map<string, { node: Coordinate, weight: number, isHighway: boolean, isFloodRisk: boolean }[]> = new Map();
  visitedEdges: Set<string> = new Set(); // Micro-Goal: Visited route memory cache

  addNode(coord: Coordinate) {
    const key = coord.join(',');
    if (!this.adjacencyList.has(key)) {
      this.adjacencyList.set(key, []);
    }
  }

  addEdge(coord1: Coordinate, coord2: Coordinate, highwayType: string = 'unknown') {
    this.addNode(coord1);
    this.addNode(coord2);
    const key1 = coord1.join(',');
    const key2 = coord2.join(',');
    
    // Assumed Speed Limits based on Highway Classification (km/h)
    let speedLimitKmh = 40; // Default generic road
    if (highwayType === 'motorway' || highwayType === 'trunk') speedLimitKmh = 90;
    else if (highwayType === 'primary') speedLimitKmh = 60;
    else if (highwayType === 'secondary') speedLimitKmh = 40;
    else if (highwayType === 'tertiary' || highwayType === 'residential') speedLimitKmh = 30;
    else if (highwayType === 'unclassified' || highwayType === 'path') speedLimitKmh = 15;
    
    // Calculate Travel Time (Cost Weight in Seconds)
    const speedLimitMs = speedLimitKmh * (1000 / 3600);
    const distance = getDistance(coord1, coord2);
    let timeCostSeconds = distance / speedLimitMs;
    
    // Elevation / Flood Risk Heuristic (Synthetic removed for real roads)
    const isFloodRisk = false; 

    if (!this.adjacencyList.get(key1)?.some(e => e.node.join(',') === key2)) {
      const isHighway = ['motorway', 'trunk', 'primary'].includes(highwayType);
      this.adjacencyList.get(key1)!.push({ node: coord2, weight: timeCostSeconds, isHighway, isFloodRisk });
      this.adjacencyList.get(key2)!.push({ node: coord1, weight: timeCostSeconds, isHighway, isFloodRisk }); // Undirected
    }
  }

  buildFromGeoJSON(geoJson: FeatureCollection<LineString>) {
    geoJson.features.forEach(feature => {
      const coords = feature.geometry.coordinates as Coordinate[];
      const highwayType = feature.properties?.highway || 'unknown';
      for (let i = 0; i < coords.length - 1; i++) {
        this.addEdge(coords[i], coords[i + 1], highwayType);
      }
    });
  }

  // Inject crowd-sourced mesh trails dynamically into the routing graph
  injectBreadcrumbs(trails: Coordinate[][]) {
    for (const trail of trails) {
      for (let i = 0; i < trail.length - 1; i++) {
        // Treat user trails as 'path' (15km/h speed limit)
        this.addEdge(trail[i], trail[i + 1], 'path');
      }
    }
  }

  getClosestNodes(target: Coordinate, count: number = 5): Coordinate[] {
    const nodes: {coord: Coordinate, dist: number}[] = [];

    for (const key of this.adjacencyList.keys()) {
      const [lon, lat] = key.split(',').map(Number);
      const coord: Coordinate = [lon, lat];
      const dist = getDistance(target, coord);
      nodes.push({ coord, dist });
    }
    
    nodes.sort((a, b) => a.dist - b.dist);
    return nodes.slice(0, count).map(n => n.coord);
  }

  // OSPF / Dijkstra's Search Algorithm - Dynamic Link-State Routing
  findPath(startRaw: Coordinate, endRaw: Coordinate, anomalies: { coordinates: Coordinate, type: string }[] = [], drawnFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] }, resources: string[] = []): RouteStats | null {
    const startNodes = this.getClosestNodes(startRaw, 15); // Increased to 15 to escape deep off-road/isolated tracks
    const endNodes = this.getClosestNodes(endRaw, 25); // Increased to 25 to guarantee finding a connected road near shelters
    
    if (startNodes.length === 0 || endNodes.length === 0) return null;
    
    const endKeys = new Set(endNodes.map(n => n.join(',')));
    
    let bestPartialStats: RouteStats | null = null;
    let minDistanceToEnd = Infinity;

    for (const start of startNodes) {
      const startKey = start.join(',');
      const openSet = new Set<string>([startKey]);
      const cameFrom = new Map<string, string>();
      const gScore = new Map<string, number>();
      gScore.set(startKey, 0);
      const fScore = new Map<string, number>();
      fScore.set(startKey, getDistance(start, endRaw) * 0.5);

      let found = false;

      while (openSet.size > 0) {
        let currentKey = '';
        let minF = Infinity;

        for (const key of openSet) {
          const score = fScore.get(key);
          if (score !== undefined && score < minF) {
            minF = score;
            currentKey = key;
          }
        }

        if (!currentKey) break;

        if (endKeys.has(currentKey)) {
          found = true;
          // Store the actual matched end node for path reconstruction
          endKeys.clear();
          endKeys.add(currentKey); 
          break;
        }

        openSet.delete(currentKey);

        const neighbors = this.adjacencyList.get(currentKey) || [];
        for (const neighbor of neighbors) {
          const neighborKey = neighbor.node.join(',');
          
          let traversalCost = neighbor.weight;
          
          // Heavily penalize minor tracks/residential roads to force routing onto the main highway grid
          if (!neighbor.isHighway) {
            traversalCost *= 4.0;
          }
          
          if (neighbor.isFloodRisk && (resources.includes('Boat') || resources.includes('Amphibious'))) {
            traversalCost = traversalCost / 5.0; 
          }
          
          for (const anomaly of anomalies) {
            if (getDistance(neighbor.node, anomaly.coordinates) < 400) traversalCost += 3600;
          }
          
          for (const feature of drawnFeatures.features) {
            if (feature.geometry.type === 'Point' && feature.properties?.type === 'risk') {
              if (getDistance(neighbor.node, feature.geometry.coordinates as Coordinate) < 400) traversalCost += 3600;
            } else if (feature.geometry.type === 'Polygon' && feature.properties?.type === 'flood') {
              const polygonCoords = feature.geometry.coordinates as Coordinate[][];
              if (polygonCoords && polygonCoords.length > 0 && isPointInPolygon(neighbor.node, polygonCoords)) {
                if (!resources.includes('Boat') && !resources.includes('Amphibious')) traversalCost += 3600 * 5;
              }
            }
          }
          
          const edgeId1 = `${currentKey}-${neighborKey}`;
          const edgeId2 = `${neighborKey}-${currentKey}`;
          if (this.visitedEdges.has(edgeId1) || this.visitedEdges.has(edgeId2)) traversalCost *= 0.2;

          const tentative_gScore = (gScore.get(currentKey) ?? Infinity) + traversalCost;

          if (tentative_gScore < (gScore.get(neighborKey) ?? Infinity)) {
            cameFrom.set(neighborKey, currentKey);
            gScore.set(neighborKey, tentative_gScore);
            fScore.set(neighborKey, tentative_gScore + (getDistance(neighbor.node, endRaw) * 0.5));
            openSet.add(neighborKey);
          }
        }
      }

      if (found) {
        const finalEndKey = Array.from(endKeys)[0];
        const finalEndNode = finalEndKey.split(',').map(Number) as Coordinate;
        const stats = this.reconstructPath(cameFrom, finalEndKey);
        stats.path.unshift(startRaw);
        stats.path.push(endRaw);
        const offRoadDist = getDistance(startRaw, start) + getDistance(finalEndNode, endRaw);
        stats.totalDistance += offRoadDist;
        stats.travelTimeMinutes += Math.ceil((offRoadDist / (15 * (1000 / 3600))) / 60);
        return stats;
      }

      // Track fallback if isolated
      if (gScore.size > 0) {
        for (const key of gScore.keys()) {
          const [lon, lat] = key.split(',').map(Number);
          const dist = getDistance([lon, lat], endRaw);
          if (dist < minDistanceToEnd) {
            minDistanceToEnd = dist;
            bestPartialStats = this.reconstructPath(cameFrom, key);
          }
        }
      }
    }

    if (bestPartialStats) {
      bestPartialStats.path.unshift(startRaw);
      bestPartialStats.path.push(endRaw);
      const offRoadDist = getDistance(startRaw, bestPartialStats.path[1]) + getDistance(bestPartialStats.path[bestPartialStats.path.length - 2], endRaw);
      bestPartialStats.totalDistance += offRoadDist;
      bestPartialStats.travelTimeMinutes += Math.ceil((offRoadDist / (15 * (1000 / 3600))) / 60);
      return bestPartialStats;
    }

    return null; 
  }

  private reconstructPath(cameFrom: Map<string, string>, currentKey: string): RouteStats {
    const path: Coordinate[] = [currentKey.split(',').map(Number) as Coordinate];
    let totalDistance = 0;
    let travelTimeSeconds = 0;
    let minElevation = Infinity;
    let floodRiskWarnings = 0;

    while (cameFrom.has(currentKey)) {
      const prevKey = currentKey;
      currentKey = cameFrom.get(currentKey)!;
      const coord = prevKey.split(',').map(Number) as Coordinate;
      const prevCoord = currentKey.split(',').map(Number) as Coordinate;
      path.unshift(prevCoord);
      
      // Mark edge as visited for future routing
      this.visitedEdges.add(`${prevKey}-${currentKey}`);
      
      // Calculate stats for this leg
      const ele = getElevation(prevCoord);
      if (ele < minElevation) minElevation = ele;
      if (ele < 12.0) floodRiskWarnings++;
      totalDistance += getDistance(coord, prevCoord);
      
      // Accumulate true time cost
      const edge = this.adjacencyList.get(currentKey)?.find(e => e.node.join(',') === prevKey);
      if (edge) travelTimeSeconds += edge.weight;
    }
    
    return { path, totalDistance, travelTimeMinutes: Math.ceil(travelTimeSeconds / 60), minElevation, floodRiskWarnings };
  }
}

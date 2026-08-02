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
export function getElevation(coord: Coordinate): number {
  const [lon, lat] = coord;
  const dx = (lon - 85.8) * 100;
  const dy = (lat - 20.3) * 100;
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
  if (!polygon || !polygon[0] || polygon[0].length < 3) return false;
  const x = point[0], y = point[1];
  let inside = false;
  const ring = polygon[0];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pI = ring[i];
    const pJ = ring[j];
    if (!pI || !pJ) continue;
    const xi = pI[0], yi = pI[1];
    const xj = pJ[0], yj = pJ[1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

class PriorityQueue<T> {
  private heap: { element: T; priority: number }[] = [];

  push(element: T, priority: number) {
    this.heap.push({ element, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].element;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  peekPriority(): number | undefined {
    return this.heap.length > 0 ? this.heap[0].priority : undefined;
  }

  size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (this.heap[index].priority >= this.heap[parentIndex].priority) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private sinkDown(index: number) {
    const length = this.heap.length;
    const element = this.heap[index];
    while (true) {
      let leftChildIndex = 2 * index + 1;
      let rightChildIndex = 2 * index + 2;
      let swapIndex = -1;

      if (leftChildIndex < length) {
        if (this.heap[leftChildIndex].priority < element.priority) {
          swapIndex = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        const comparePriority = swapIndex === -1 ? element.priority : this.heap[leftChildIndex].priority;
        if (this.heap[rightChildIndex].priority < comparePriority) {
          swapIndex = rightChildIndex;
        }
      }

      if (swapIndex === -1) break;
      this.heap[index] = this.heap[swapIndex];
      this.heap[swapIndex] = element;
      index = swapIndex;
    }
  }
}

const toKey = (c: Coordinate) => `${Math.round(c[0] * 1e6) / 1e6},${Math.round(c[1] * 1e6) / 1e6}`;

export class PathGraph {
  adjacencyList: Map<string, { node: Coordinate, weight: number, isHighway: boolean, isFloodRisk: boolean }[]> = new Map();
  visitedEdges: Set<string> = new Set(); // Visited route memory cache

  addNode(coord: Coordinate) {
    const key = toKey(coord);
    if (!this.adjacencyList.has(key)) {
      this.adjacencyList.set(key, []);
    }
  }

  addEdge(coord1: Coordinate, coord2: Coordinate, highwayType: string = 'unknown') {
    this.addNode(coord1);
    this.addNode(coord2);
    const key1 = toKey(coord1);
    const key2 = toKey(coord2);
    
    let speedLimitKmh = 40;
    if (highwayType === 'motorway' || highwayType === 'trunk') speedLimitKmh = 90;
    else if (highwayType === 'primary') speedLimitKmh = 60;
    else if (highwayType === 'secondary') speedLimitKmh = 40;
    else if (highwayType === 'tertiary' || highwayType === 'residential') speedLimitKmh = 30;
    else if (highwayType === 'unclassified' || highwayType === 'path') speedLimitKmh = 15;
    
    const speedLimitMs = speedLimitKmh * (1000 / 3600);
    const distance = getDistance(coord1, coord2);
    let timeCostSeconds = distance / speedLimitMs;
    
    const isFloodRisk = false; 

    if (!this.adjacencyList.get(key1)?.some(e => e.node.join(',') === key2)) {
      const isHighway = ['motorway', 'trunk', 'primary'].includes(highwayType);
      this.adjacencyList.get(key1)!.push({ node: coord2, weight: timeCostSeconds, isHighway, isFloodRisk });
      this.adjacencyList.get(key2)!.push({ node: coord1, weight: timeCostSeconds, isHighway, isFloodRisk });
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

  injectBreadcrumbs(trails: Coordinate[][]) {
    for (const trail of trails) {
      for (let i = 0; i < trail.length - 1; i++) {
        this.addEdge(trail[i], trail[i + 1], 'path');
      }
    }
  }

  getClosestNodes(target: Coordinate, count: number = 5, requireHighway: boolean = false): Coordinate[] {
    const nodes: {coord: Coordinate, dist: number}[] = [];

    for (const [key, edges] of this.adjacencyList.entries()) {
      if (requireHighway) {
        if (!edges.some(e => e.isHighway)) continue;
      }
      const [lon, lat] = key.split(',').map(Number);
      const coord: Coordinate = [lon, lat];
      const dist = getDistance(target, coord);
      nodes.push({ coord, dist });
    }
    
    nodes.sort((a, b) => a.dist - b.dist);
    return nodes.slice(0, count).map(n => n.coord);
  }

  // Tiered Multi-Level Tactical Route Finder
  findPath(
    startRaw: Coordinate,
    endRaw: Coordinate,
    anomalies: { coordinates: Coordinate, type: string }[] = [],
    drawnFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] },
    resources: string[] = [],
    onProgress?: (progressPercent: number) => void
  ): RouteStats | null {
    const directDist = getDistance(startRaw, endRaw);
    const isLongDistance = directDist > 20000; // 20 km threshold

    if (isLongDistance) {
      // 1. Long-distance optimization: Highway Backbone Bidirectional A* (filters local sub-nodes)
      const highwayRoute = this.runBidirectionalAStar(
        startRaw, endRaw, anomalies, drawnFeatures, resources, true, onProgress
      );
      if (highwayRoute) return highwayRoute;
    }

    // 2. Full network fallback (or local distance route)
    return this.runBidirectionalAStar(
      startRaw, endRaw, anomalies, drawnFeatures, resources, false, onProgress
    );
  }

  // Bidirectional A* Core Search Engine
  private runBidirectionalAStar(
    startRaw: Coordinate,
    endRaw: Coordinate,
    anomalies: { coordinates: Coordinate, type: string }[],
    drawnFeatures: FeatureCollection,
    resources: string[],
    highwayOnlyMode: boolean,
    onProgress?: (progressPercent: number) => void
  ): RouteStats | null {
    const startNodes = [
      ...this.getClosestNodes(startRaw, 5),
      ...(highwayOnlyMode ? this.getClosestNodes(startRaw, 5, true) : [])
    ];

    const endNodes = [
      ...this.getClosestNodes(endRaw, 5),
      ...(highwayOnlyMode ? this.getClosestNodes(endRaw, 5, true) : [])
    ];
    
    if (startNodes.length === 0 || endNodes.length === 0) return null;

    const openForward = new PriorityQueue<string>();
    const openBackward = new PriorityQueue<string>();

    const gForward = new Map<string, number>();
    const gBackward = new Map<string, number>();

    const cameFromForward = new Map<string, string>();
    const cameFromBackward = new Map<string, string>();

    const MAX_SPEED_MS = 25.0; // 90 km/h max speed for admissible heuristic (m/s)
    const initialDirectDist = getDistance(startRaw, endRaw);

    for (const start of startNodes) {
      const key = toKey(start);
      const initialOffRoadCost = getDistance(startRaw, start) / 4.1; // 15 km/h off-road
      if (!gForward.has(key) || initialOffRoadCost < gForward.get(key)!) {
        gForward.set(key, initialOffRoadCost);
        const h = getDistance(start, endRaw) / MAX_SPEED_MS;
        openForward.push(key, initialOffRoadCost + h);
      }
    }

    for (const end of endNodes) {
      const key = toKey(end);
      const initialOffRoadCost = getDistance(endRaw, end) / 4.1;
      if (!gBackward.has(key) || initialOffRoadCost < gBackward.get(key)!) {
        gBackward.set(key, initialOffRoadCost);
        const h = getDistance(end, startRaw) / MAX_SPEED_MS;
        openBackward.push(key, initialOffRoadCost + h);
      }
    }

    let touchNode: string | null = null;
    let bestTotalCost = Infinity;
    let bestPartialKeyForward: string | null = null;
    let minDistanceToEndForward = Infinity;
    let iterations = 0;

    const getEdgeCost = (_currNode: Coordinate, neighborNode: Coordinate, weight: number, isHighway: boolean, isFloodRisk: boolean): number => {
      let traversalCost = weight;
      if (!isHighway) traversalCost *= 3.5;
      if (isFloodRisk && (resources.includes('Boat') || resources.includes('Amphibious'))) {
        traversalCost = traversalCost / 5.0;
      }

      for (const anomaly of anomalies) {
        const dist = getDistance(neighborNode, anomaly.coordinates);
        if (dist < 400) {
          const factor = 1 - (dist / 400);
          traversalCost += 3600 * (factor * factor);
        }
      }

      for (const feature of drawnFeatures.features) {
        if (feature.geometry.type === 'Point' && feature.properties?.type === 'risk') {
          const dist = getDistance(neighborNode, feature.geometry.coordinates as Coordinate);
          if (dist < 400) {
            const factor = 1 - (dist / 400);
            traversalCost += 3600 * (factor * factor);
          }
        } else if (feature.geometry.type === 'Polygon' && feature.properties?.type === 'flood') {
          const polygonCoords = feature.geometry.coordinates as Coordinate[][];
          if (polygonCoords && polygonCoords.length > 0 && isPointInPolygon(neighborNode, polygonCoords)) {
            if (!resources.includes('Boat') && !resources.includes('Amphibious')) traversalCost += 3600 * 5;
          }
        }
      }
      return traversalCost;
    };

    while (openForward.size() > 0 && openBackward.size() > 0) {
      iterations++;
      
      if (iterations % 150 === 0 && onProgress) {
        const remainingEst = Math.min(initialDirectDist, minDistanceToEndForward);
        const progressPct = Math.min(95, Math.max(5, Math.round((1 - (remainingEst / (initialDirectDist || 1))) * 100)));
        onProgress(progressPct);
      }

      if (touchNode && (openForward.peekPriority()! + openBackward.peekPriority()! >= bestTotalCost)) {
        break;
      }

      if (openForward.peekPriority()! <= openBackward.peekPriority()!) {
        // --- Forward Step ---
        const currentKey = openForward.pop()!;
        const currentG = gForward.get(currentKey);
        if (currentG === undefined) continue;

        const currCoord = currentKey.split(',').map(Number) as Coordinate;
        const neighbors = this.adjacencyList.get(currentKey) || [];

        for (const neighbor of neighbors) {
          const neighborKey = toKey(neighbor.node);
          let traversalCost = getEdgeCost(currCoord, neighbor.node, neighbor.weight, neighbor.isHighway, neighbor.isFloodRisk);
          if (highwayOnlyMode && !neighbor.isHighway) {
            traversalCost *= 3.0; // Soft highway bias: prefer highways for backbone while allowing seamless local access
          }
          const edgeId1 = `${currentKey}-${neighborKey}`;
          const edgeId2 = `${neighborKey}-${currentKey}`;
          if (this.visitedEdges.has(edgeId1) || this.visitedEdges.has(edgeId2)) traversalCost *= 0.8;

          const tentativeG = currentG + traversalCost;
          if (tentativeG < (gForward.get(neighborKey) ?? Infinity)) {
            cameFromForward.set(neighborKey, currentKey);
            gForward.set(neighborKey, tentativeG);
            const h = getDistance(neighbor.node, endRaw) / MAX_SPEED_MS;
            openForward.push(neighborKey, tentativeG + h);

            if (h * MAX_SPEED_MS < minDistanceToEndForward) {
              minDistanceToEndForward = h * MAX_SPEED_MS;
              bestPartialKeyForward = neighborKey;
            }

            if (gBackward.has(neighborKey)) {
              const totalCost = tentativeG + gBackward.get(neighborKey)!;
              if (totalCost < bestTotalCost) {
                bestTotalCost = totalCost;
                touchNode = neighborKey;
              }
            }
          }
        }
      } else {
        // --- Backward Step ---
        const currentKey = openBackward.pop()!;
        const currentG = gBackward.get(currentKey);
        if (currentG === undefined) continue;

        const currCoord = currentKey.split(',').map(Number) as Coordinate;
        const neighbors = this.adjacencyList.get(currentKey) || [];

        for (const neighbor of neighbors) {
          const neighborKey = toKey(neighbor.node);
          let traversalCost = getEdgeCost(currCoord, neighbor.node, neighbor.weight, neighbor.isHighway, neighbor.isFloodRisk);
          if (highwayOnlyMode && !neighbor.isHighway) {
            traversalCost *= 3.0;
          }
          const edgeId1 = `${currentKey}-${neighborKey}`;
          const edgeId2 = `${neighborKey}-${currentKey}`;
          if (this.visitedEdges.has(edgeId1) || this.visitedEdges.has(edgeId2)) traversalCost *= 0.8;

          const tentativeG = currentG + traversalCost;
          if (tentativeG < (gBackward.get(neighborKey) ?? Infinity)) {
            cameFromBackward.set(neighborKey, currentKey);
            gBackward.set(neighborKey, tentativeG);
            const h = getDistance(neighbor.node, startRaw) / MAX_SPEED_MS;
            openBackward.push(neighborKey, tentativeG + h);

            if (gForward.has(neighborKey)) {
              const totalCost = tentativeG + gForward.get(neighborKey)!;
              if (totalCost < bestTotalCost) {
                bestTotalCost = totalCost;
                touchNode = neighborKey;
              }
            }
          }
        }
      }
    }

    if (onProgress) onProgress(100);

    if (touchNode) {
      const stats = this.reconstructBidirectionalPath(cameFromForward, cameFromBackward, touchNode);
      const matchedStartNode = stats.path[0];
      const matchedEndNode = stats.path[stats.path.length - 1];
      stats.path.unshift(startRaw);
      stats.path.push(endRaw);
      const offRoadDist = getDistance(startRaw, matchedStartNode) + getDistance(matchedEndNode, endRaw);
      stats.totalDistance += offRoadDist;
      stats.travelTimeMinutes += Math.ceil((offRoadDist / (15 * (1000 / 3600))) / 60);
      return stats;
    }

    if (!highwayOnlyMode && bestPartialKeyForward) {
      const stats = this.reconstructPath(cameFromForward, bestPartialKeyForward);
      const matchedStartNode = stats.path[0];
      const matchedEndNode = stats.path[stats.path.length - 1];
      const endGap = getDistance(matchedEndNode, endRaw);
      
      if (endGap > 1500) {
        return null;
      }

      stats.path.unshift(startRaw);
      stats.path.push(endRaw);
      const offRoadDist = getDistance(startRaw, matchedStartNode) + endGap;
      stats.totalDistance += offRoadDist;
      stats.travelTimeMinutes += Math.ceil((offRoadDist / (15 * (1000 / 3600))) / 60);
      return stats;
    }

    return null; 
  }

  private reconstructBidirectionalPath(
    cameFromForward: Map<string, string>,
    cameFromBackward: Map<string, string>,
    touchNode: string
  ): RouteStats {
    const forwardStats = this.reconstructPath(cameFromForward, touchNode);

    const backwardPath: Coordinate[] = [];
    let curr: string = touchNode;
    while (cameFromBackward.has(curr)) {
      const nextKey = cameFromBackward.get(curr)!;
      const prevCoord = curr.split(',').map(Number) as Coordinate;
      const nextCoord = nextKey.split(',').map(Number) as Coordinate;
      
      this.visitedEdges.add(`${curr}-${nextKey}`);
      
      const ele = getElevation(nextCoord);
      if (ele < forwardStats.minElevation) forwardStats.minElevation = ele;
      if (ele < 12.0) forwardStats.floodRiskWarnings++;
      
      const legDist = getDistance(prevCoord, nextCoord);
      forwardStats.totalDistance += legDist;
      
      const edge = this.adjacencyList.get(curr)?.find(e => e.node.join(',') === nextKey);
      if (edge) {
        forwardStats.travelTimeMinutes += Math.ceil(edge.weight / 60);
      }

      backwardPath.push(nextCoord);
      curr = nextKey;
    }

    forwardStats.path.push(...backwardPath);
    return forwardStats;
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
      
      this.visitedEdges.add(`${prevKey}-${currentKey}`);
      
      const ele = getElevation(prevCoord);
      if (ele < minElevation) minElevation = ele;
      if (ele < 12.0) floodRiskWarnings++;
      totalDistance += getDistance(coord, prevCoord);
      
      const edge = this.adjacencyList.get(currentKey)?.find(e => e.node.join(',') === prevKey);
      if (edge) travelTimeSeconds += edge.weight;
    }
    
    return { path, totalDistance, travelTimeMinutes: Math.ceil(travelTimeSeconds / 60), minElevation, floodRiskWarnings };
  }
}

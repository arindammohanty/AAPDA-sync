import type { NodeID, Coordinate, GraphNode, AdjacencyGraph } from './graph';
import { calculateHaversine } from './graph';

export function parseGeoJSONToGraph(geoJson: any): { graph: AdjacencyGraph, nodes: Map<NodeID, GraphNode> } {
  const graph: AdjacencyGraph = new Map();
  const nodes: Map<NodeID, GraphNode> = new Map();

  if (!geoJson || geoJson.type !== 'FeatureCollection' || !Array.isArray(geoJson.features)) {
    console.warn('Invalid GeoJSON FeatureCollection provided for ingestion.');
    return { graph, nodes };
  }

  geoJson.features.forEach((feature: any) => {
    if (feature.geometry && feature.geometry.type === 'LineString') {
      const coordinates: number[][] = feature.geometry.coordinates;

      for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i] as Coordinate;
        // Generate a deterministic node ID based on coordinates to avoid duplicates
        // Warning: Geohash is preferred for space, but string concatenation is simple for MVP
        const nodeId = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
        
        if (!nodes.has(nodeId)) {
          nodes.set(nodeId, { id: nodeId, coords: coord });
        }

        if (!graph.has(nodeId)) {
          graph.set(nodeId, []);
        }

        // Connect to the previous node in the LineString
        if (i > 0) {
          const prevCoord = coordinates[i - 1] as Coordinate;
          const prevNodeId = `${prevCoord[0].toFixed(6)},${prevCoord[1].toFixed(6)}`;
          
          const weight = calculateHaversine(coord, prevCoord);

          // Add edge from prev -> current
          graph.get(prevNodeId)!.push({
            target: nodeId,
            weight,
            isBlocked: false
          });

          // Add edge from current -> prev (assuming bidirectional road networks by default)
          graph.get(nodeId)!.push({
            target: prevNodeId,
            weight,
            isBlocked: false
          });
        }
      }
    }
  });

  return { graph, nodes };
}

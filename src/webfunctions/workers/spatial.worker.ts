import type { AdjacencyGraph, GraphNode, NodeID } from '../math/graph';
import { parseGeoJSONToGraph } from '../math/ingestion';
import { SpatialIndex } from '../math/spatial_index';
import { executeModifiedAStar } from '../math/routing';
import { deserializeArrayBufferToPolygon } from '../math/sanitization';

let graph: AdjacencyGraph = new Map();
let nodes: Map<NodeID, GraphNode> = new Map();
let spatialIndex = new SpatialIndex();

self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'INGEST_GEOJSON':
        // Expecting raw GeoJSON object for MVP
        console.log('Worker: Ingesting GeoJSON...');
        const result = parseGeoJSONToGraph(payload);
        graph = result.graph;
        nodes = result.nodes;
        console.log(`Worker: Graph parsed. ${nodes.size} nodes, ${graph.size} active edges.`);
        
        console.log('Worker: Building R-Tree index...');
        spatialIndex.buildIndex(graph, nodes);
        console.log('Worker: Spatial index ready.');
        
        self.postMessage({ type: 'INGEST_COMPLETE', success: true });
        break;

      case 'ROUTE_REQUEST':
        // Expecting { start: NodeID, target: NodeID }
        console.log(`Worker: Calculating route from ${payload.start} to ${payload.target}...`);
        const path = executeModifiedAStar(payload.start, payload.target, graph, nodes);
        
        if (path) {
          console.log(`Worker: Route found. Sequence length: ${path.length}`);
          self.postMessage({ type: 'ROUTE_RESULT', path });
        } else {
          console.warn('Worker: Route failed. Island deadlock or unreachable target.');
          self.postMessage({ type: 'ROUTE_RESULT', path: null, error: 'UNREACHABLE_BY_LAND' });
        }
        break;

      case 'HAZARD_BLOCK':
        // Payload expects a zero-copy ArrayBuffer containing the polygon coordinates
        const polygon = deserializeArrayBufferToPolygon(payload as ArrayBuffer);
        
        // Calculate bounding box of the polygon for the R-Tree search
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of polygon.coordinates) {
          for (const coord of ring) {
            if (coord[0] < minX) minX = coord[0];
            if (coord[1] < minY) minY = coord[1];
            if (coord[0] > maxX) maxX = coord[0];
            if (coord[1] > maxY) maxY = coord[1];
          }
        }

        const intersectedSegments = spatialIndex.searchIntersection(minX, minY, maxX, maxY);
        let blockedCount = 0;

        for (const segment of intersectedSegments) {
          const edges = graph.get(segment.sourceNode);
          if (edges) {
            const edge = edges.find(e => e.target === segment.targetNode);
            if (edge && !edge.isBlocked) {
              edge.isBlocked = true;
              blockedCount++;
            }
          }
          // bidirectional block
          const reverseEdges = graph.get(segment.targetNode);
          if (reverseEdges) {
            const rEdge = reverseEdges.find(e => e.target === segment.sourceNode);
            if (rEdge && !rEdge.isBlocked) {
              rEdge.isBlocked = true;
              blockedCount++;
            }
          }
        }
        
        console.log(`Worker: Hazard applied. Blocked ${blockedCount} edges.`);
        self.postMessage({ type: 'HAZARD_APPLIED', blockedCount });
        break;

      default:
        console.warn(`Worker: Unknown command type ${type}`);
    }
  } catch (err) {
    console.error('Worker error:', err);
    self.postMessage({ type: 'ERROR', message: String(err) });
  }
};

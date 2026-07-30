import RBush from 'rbush';
import type { NodeID, GraphNode, AdjacencyGraph } from './graph';

export interface RoadSegmentBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sourceNode: NodeID;
  targetNode: NodeID;
}

export class SpatialIndex {
  private tree: RBush<RoadSegmentBBox>;

  constructor() {
    this.tree = new RBush<RoadSegmentBBox>();
  }

  /**
   * Initializes the R-Tree with bounding boxes for all edges in the adjacency graph.
   * Enables O(log N) coarse spatial filtering for hazard intersection.
   */
  public buildIndex(graph: AdjacencyGraph, nodes: Map<NodeID, GraphNode>) {
    const items: RoadSegmentBBox[] = [];

    // Avoid double counting bidirectional edges by keeping track of processed segments
    const processed = new Set<string>();

    for (const [sourceId, edges] of graph.entries()) {
      const source = nodes.get(sourceId);
      if (!source) continue;

      for (const edge of edges) {
        const targetId = edge.target;
        const target = nodes.get(targetId);
        if (!target) continue;

        const segmentId1 = `${sourceId}-${targetId}`;
        const segmentId2 = `${targetId}-${sourceId}`;

        if (processed.has(segmentId1) || processed.has(segmentId2)) {
          continue;
        }
        processed.add(segmentId1);

        const minX = Math.min(source.coords[0], target.coords[0]);
        const maxX = Math.max(source.coords[0], target.coords[0]);
        const minY = Math.min(source.coords[1], target.coords[1]);
        const maxY = Math.max(source.coords[1], target.coords[1]);

        items.push({
          minX, minY, maxX, maxY,
          sourceNode: sourceId,
          targetNode: targetId
        });
      }
    }

    this.tree.clear();
    this.tree.load(items);
  }

  /**
   * Coarse filter: Returns all road segments whose bounding box intersects with the given query box.
   */
  public searchIntersection(minX: number, minY: number, maxX: number, maxY: number): RoadSegmentBBox[] {
    return this.tree.search({ minX, minY, maxX, maxY });
  }
}

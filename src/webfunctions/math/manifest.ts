import type { NodeID, GraphNode } from './graph';

export interface RouteManifest {
  totalDistanceMeters: number;
  instructions: string[];
  rawText: string;
}

export class ManifestGenerator {
  /**
   * Aggregates multiple sequential A* path arrays into a single contiguous array,
   * deduplicating overlapping junction nodes.
   */
  public static aggregatePaths(paths: NodeID[][]): NodeID[] {
    if (!paths || paths.length === 0) return [];

    const aggregated: NodeID[] = [];

    for (let i = 0; i < paths.length; i++) {
      const currentPath = paths[i];
      if (!currentPath || currentPath.length === 0) continue;

      // If it's not the first path, skip the first node (which overlaps with the last node of the previous path)
      const startIndex = (i > 0 && aggregated.length > 0) ? 1 : 0;

      for (let j = startIndex; j < currentPath.length; j++) {
        aggregated.push(currentPath[j]);
      }
    }

    return aggregated;
  }

  /**
   * Parses a contiguous NodeID trajectory into a human-readable turn-by-turn rescue manifest.
   */
  public static generateManifest(trajectory: NodeID[], nodes: Map<NodeID, GraphNode>): RouteManifest {
    const instructions: string[] = [];
    let totalDistanceMeters = 0;

    if (!trajectory || trajectory.length < 2) {
      return {
        totalDistanceMeters: 0,
        instructions: ['No valid route found or destination is at the origin.'],
        rawText: 'No valid route found.'
      };
    }

    instructions.push('--- AapdaSync Rescue Manifest ---');
    instructions.push(`Departing from origin (Node: ${trajectory[0]})`);

    for (let i = 1; i < trajectory.length; i++) {
      const prev = nodes.get(trajectory[i - 1]);
      const curr = nodes.get(trajectory[i]);

      if (!prev || !curr) continue;
      
      if (i === trajectory.length - 1) {
        instructions.push(`Proceed to final destination (Node: ${trajectory[i]})`);
        instructions.push('Arrived at target zone.');
      } else if (i % 5 === 0) {
        instructions.push(`Proceed through sector (Node: ${trajectory[i]})`);
      }
    }

    return {
      totalDistanceMeters, 
      instructions,
      rawText: instructions.join('\n')
    };
  }
}

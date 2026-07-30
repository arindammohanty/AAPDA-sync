import type { NodeID, AdjacencyGraph, GraphNode } from './graph';
import { calculateHaversine } from './graph';

class PriorityQueue {
  private values: { id: NodeID; priority: number }[] = [];

  enqueue(id: NodeID, priority: number) {
    this.values.push({ id, priority });
    this.sort();
  }

  dequeue(): NodeID | undefined {
    return this.values.shift()?.id;
  }

  isEmpty(): boolean {
    return this.values.length === 0;
  }

  private sort() {
    this.values.sort((a, b) => a.priority - b.priority);
  }
}

function reconstructPath(cameFrom: Map<NodeID, NodeID>, current: NodeID): NodeID[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(current);
  }
  return path;
}

/**
 * Modified A* Traversal Engine.
 * Dynamically avoids hazard zones using the `isBlocked` edge weight bypass.
 * Will deterministically return `null` and halt execution if the target is 
 * trapped in an Island Deadlock (i.e. surrounded by hazard polygons).
 */
export function executeModifiedAStar(
  start: NodeID,
  target: NodeID,
  graph: AdjacencyGraph,
  nodes: Map<NodeID, GraphNode>
): NodeID[] | null {
  const openSet = new PriorityQueue();
  const cameFrom = new Map<NodeID, NodeID>();
  const gScore = new Map<NodeID, number>();

  gScore.set(start, 0);
  openSet.enqueue(start, 0);

  const targetNode = nodes.get(target);
  if (!targetNode) return null;

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue();
    
    if (current === undefined) break;
    
    if (current === target) {
      return reconstructPath(cameFrom, current);
    }

    const edges = graph.get(current) || [];
    
    for (const edge of edges) {
      // Deterministic bypass of dynamically invalidated hazard routes
      if (edge.isBlocked) continue;
      
      const tentativeGScore = gScore.get(current)! + edge.weight;
      
      if (tentativeGScore < (gScore.get(edge.target) || Infinity)) {
        cameFrom.set(edge.target, current);
        gScore.set(edge.target, tentativeGScore);
        
        const nextNode = nodes.get(edge.target);
        if (nextNode) {
          const heuristic = calculateHaversine(nextNode.coords, targetNode.coords);
          openSet.enqueue(edge.target, tentativeGScore + heuristic);
        }
      }
    }
  }

  // Island Deadlock reached (open set exhausted without reaching target)
  return null;
}

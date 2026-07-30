import type { Coordinate } from './pathfinding';

export const SAFE_ZONES: { id: string; name: string; coordinates: Coordinate }[] = [
  { id: 'sz-1', name: 'Kalinga Stadium', coordinates: [85.8174, 20.2882] },
  { id: 'sz-2', name: 'Biju Patnaik Airport', coordinates: [85.8178, 20.2444] },
  { id: 'sz-3', name: 'Utkal University Ground', coordinates: [85.8398, 20.3015] }
];

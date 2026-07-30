export type TriageStatus = 'PENDING' | 'DISPATCHED' | 'ON_SCENE' | 'EXTRACTING' | 'RESOLVED';

export interface Victim {
  id: string;
  name: string;
  severity: number;         // S: [1, 10]
  waterRisk: number;        // Wr: [1, 10]
  distanceMeters: number;   // D
  vulnerability: number;    // Vf: [1.0, 2.0]
  partySize: number;
  status?: TriageStatus;    // Optional for backwards compatibility
}

export interface Vehicle {
  id: string;
  capacity: number;
}

/**
 * Calculates a raw priority score if needed, but normalization is preferred.
 */
export function calculatePriorityScore(
  victim: Victim,
  w1: number = 0.50,
  w2: number = 0.20,
  w3: number = 0.10,
  w4: number = 0.20
): number {
  const { severity, waterRisk, distanceMeters, vulnerability } = victim;
  return (w1 * severity) + (w2 * waterRisk) - (w3 * Math.log(distanceMeters + 1)) + (w4 * vulnerability);
}

/**
 * Sorts victims based on priority score, with dynamic Min-Max normalization and tie-breaking logic.
 */
export function rankVictims(victims: Victim[], vehicle: Vehicle): (Victim & { score: number })[] {
  // Filter out resolved victims from active prioritization
  const activeVictims = victims.filter(v => v.status !== 'RESOLVED');
  if (activeVictims.length === 0) return [];
  
  const maxDistance = Math.max(...activeVictims.map(v => v.distanceMeters), 1);
  const maxSeverity = Math.max(...activeVictims.map(v => v.severity), 10);
  const maxWaterRisk = Math.max(...activeVictims.map(v => v.waterRisk), 1);
  const maxVulnerability = Math.max(...activeVictims.map(v => v.vulnerability), 2);

  // Weights targeting critical field conditions
  const w1 = 0.50; // Severity
  const w2 = 0.20; // Water Risk
  const w3 = 0.10; // Distance penalty
  const w4 = 0.20; // Vulnerability

  const scoredVictims = activeVictims.map(v => {
    const normSeverity = v.severity / maxSeverity;
    const normWaterRisk = v.waterRisk / maxWaterRisk;
    const normDistance = Math.log(v.distanceMeters + 1) / Math.log(maxDistance + 1);
    const normVulnerability = (v.vulnerability - 1) / (maxVulnerability - 1 || 1);

    const rawScore = (w1 * normSeverity) 
                   + (w2 * normWaterRisk) 
                   - (w3 * normDistance) 
                   + (w4 * normVulnerability);

    return {
      ...v,
      score: (rawScore + w3) * 10 // Scale up for UI readability, offset negative distance penalty
    };
  });

  return scoredVictims.sort((a, b) => {
    // 1. Primary sorting by priority score descending
    if (Math.abs(b.score - a.score) > 0.001) {
      return b.score - a.score;
    }
    
    // 2. Tie-breaker: Can the vehicle actually fit the party?
    const aFits = a.partySize <= vehicle.capacity;
    const bFits = b.partySize <= vehicle.capacity;
    
    if (aFits && !bFits) return -1;
    if (bFits && !aFits) return 1;
    
    // 3. Secondary tie-breaker: Smallest party size (maximize lives saved per seat)
    return a.partySize - b.partySize;
  });
}



import simplify from '@turf/simplify';
import type { Feature, Polygon } from 'geojson';

/**
 * Simplifies a chaotic user-drawn hazard polygon to prevent polynomial math freezes.
 * Uses Ramer-Douglas-Peucker algorithm.
 * 
 * Mandated Config:
 * - highQuality: false (Disables radial distance check, forcing O(N) execution)
 * - mutate: true (Modifies object in-place, bypassing deep-copy garbage collection)
 */
export function simplifyHazardPolygon(polygonFeature: Feature<Polygon>, tolerance: number = 0.001): Feature<Polygon> {
  return simplify(polygonFeature, {
    tolerance,
    highQuality: false,
    mutate: true
  }) as Feature<Polygon>;
}

/**
 * Serializes the polygon coordinates into a zero-copy transferable ArrayBuffer.
 * Since a GeoJSON polygon coordinates array is deeply nested (e.g., number[][][]),
 * we flat-map it into a single Float64Array.
 * 
 * Data Structure of the Float64Array:
 * [0] = number of rings
 * [1] = number of coordinates in ring 0
 * [2, 3] = coord 0 of ring 0 (lon, lat)
 * [4, 5] = coord 1 of ring 0 (lon, lat)
 * ...
 */
export function serializePolygonToArrayBuffer(polygon: Polygon): ArrayBuffer {
  const rings = polygon.coordinates;
  let totalNumbers = 1; // 1 for num rings
  
  for (const ring of rings) {
    totalNumbers += 1; // 1 for num coords in this ring
    totalNumbers += ring.length * 2; // 2 for each coordinate (lon, lat)
  }

  const buffer = new ArrayBuffer(totalNumbers * 8); // 8 bytes per Float64
  const view = new Float64Array(buffer);
  
  let offset = 0;
  view[offset++] = rings.length;

  for (const ring of rings) {
    view[offset++] = ring.length;
    for (const coord of ring) {
      view[offset++] = coord[0];
      view[offset++] = coord[1];
    }
  }

  return buffer;
}

/**
 * Deserializes the Float64Array back into a GeoJSON Polygon coordinate structure.
 * This is executed inside the Web Worker.
 */
export function deserializeArrayBufferToPolygon(buffer: ArrayBuffer): Polygon {
  const view = new Float64Array(buffer);
  let offset = 0;
  
  const numRings = view[offset++];
  const coordinates: number[][][] = [];

  for (let i = 0; i < numRings; i++) {
    const numCoords = view[offset++];
    const ring: number[][] = [];
    
    for (let j = 0; j < numCoords; j++) {
      const lon = view[offset++];
      const lat = view[offset++];
      ring.push([lon, lat]);
    }
    
    coordinates.push(ring);
  }

  return {
    type: 'Polygon',
    coordinates
  };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import type { Victim } from '../../webfunctions/math/triage';
import type { Coordinate } from '../../webfunctions/math/pathfinding';
import { SAFE_ZONES } from '../../webfunctions/math/safeZones';

// MapLibre v4+ Vite Worker Fix
maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface MapProps {
  victims?: (Victim & { coordinates: [number, number] })[];
  anomalies?: any[];
  breadcrumbs?: Coordinate[][];
  localTrail?: Coordinate[];
  selectedVictimId?: string | null;
  activeRoute?: Coordinate[];
  onUserLocationUpdate?: (coord: Coordinate) => void;
  onMapClick?: (coords: [number, number]) => void;
  onDeleteAnomaly?: (id: string) => void;
  onBroadcastTrail?: () => void;
}

export default function Map({ victims = [], anomalies = [], breadcrumbs = [], localTrail = [], selectedVictimId = null, activeRoute = [], onUserLocationUpdate, onMapClick, onDeleteAnomaly, onBroadcastTrail }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: maplibregl.Marker }>({});

  // Drawing State
  const [drawMode, setDrawMode] = useState<'none' | 'flood' | 'risk'>('none');
  const [drawnFeatures, setDrawnFeatures] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: []
  });
  const currentPolygonCoords = useRef<[number, number][]>([]);

  // Register PMTiles once
  useEffect(() => {
    try {
      const protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
    } catch (e) {
      // Protocol likely already added
    }
  }, []);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const initMap = async () => {
      try {
        const res = await fetch('/voyager-style.json');
        const style = await res.json();
        const origin = window.location.origin;

        // Force absolute URLs for MapLibre strict validation
        if (style.sprite && style.sprite.startsWith('/')) style.sprite = origin + style.sprite;
        if (style.glyphs && style.glyphs.startsWith('/')) style.glyphs = origin + style.glyphs;
        if (style.sources?.carto?.tiles?.[0]?.startsWith('/')) {
          style.sources.carto.tiles[0] = origin + style.sources.carto.tiles[0];
        }

        const mapOptions: any = {
          container: mapContainer.current,
          style: style, 
          center: [85.8245, 20.2961], // Bhubaneshwar coordinates
          zoom: 13,
          maxZoom: 22,
          minZoom: 2,
          keyboard: true,
          clickTolerance: 15,
        };

        map.current = new maplibregl.Map(mapOptions);

    // 1. Setup Geolocation Control
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 6000 },
      trackUserLocation: true,
      showAccuracyCircle: false
    });
    map.current.addControl(geolocate, 'bottom-right');

    geolocate.on('geolocate', (e: any) => {
      if (onUserLocationUpdate) {
        onUserLocationUpdate([e.coords.longitude, e.coords.latitude]);
      }
    });

    geolocate.on('error', (e: any) => {
      console.warn('Geolocation failed (laptop/permissions). Using fallback location.', e);
      // Fallback: center of Bhubaneshwar
      const fallbackCoords: [number, number] = [85.8245, 20.2961];
      if (onUserLocationUpdate) {
        onUserLocationUpdate(fallbackCoords);
      }
      map.current?.flyTo({ center: fallbackCoords, zoom: 12 });
    });

    map.current.on('load', () => {
      // Auto-trigger geolocation once loaded
      setTimeout(() => geolocate.trigger(), 500);

      // 1. Drawing Data Source
      map.current!.addSource('draw-data', {
        type: 'geojson',
        data: drawnFeatures
      });

      // 2. Flood Zone Polygon Layer
      map.current!.addLayer({
        id: 'draw-flood-fill',
        type: 'fill',
        source: 'draw-data',
        filter: ['==', 'type', 'flood'],
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.4,
          'fill-outline-color': '#1d4ed8'
        }
      });

      // 3. Risk Point Layers (Black core, Red Glow)
      map.current!.addLayer({
        id: 'draw-risk-point-glow',
        type: 'circle',
        source: 'draw-data',
        filter: ['==', 'type', 'risk'],
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': 18,
          'circle-opacity': 0.4,
          'circle-blur': 0.5
        }
      });
      map.current!.addLayer({
        id: 'draw-risk-point-core',
        type: 'circle',
        source: 'draw-data',
        filter: ['==', 'type', 'risk'],
        paint: {
          'circle-color': '#000000',
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ef4444'
        }
      });

      // 4. Active A* Route Layer
      map.current!.addSource('active-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current!.addLayer({
        id: 'active-route-layer',
        type: 'line',
        source: 'active-route',
        paint: {
          'line-color': '#1a73e8', // Standard routing blue
          'line-width': 4,
          'line-opacity': 0.8
        }
      });

      // 5. Mesh Breadcrumbs Layer
      map.current!.addSource('mesh-breadcrumbs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current!.addLayer({
        id: 'mesh-breadcrumbs-layer',
        type: 'line',
        source: 'mesh-breadcrumbs',
        paint: {
          'line-color': '#10b981', // Emerald green for safe paths
          'line-width': 3,
          'line-dasharray': [2, 2],
          'line-opacity': 0.7
        }
      });

      // 6. Local Live Trail Layer
      map.current!.addSource('local-trail', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      // 6. Local Live Trail Layer
      map.current!.addSource('local-trail', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.current!.addLayer({
        id: 'local-trail-layer',
        type: 'line',
        source: 'local-trail',
        paint: {
          'line-color': '#f59e0b', // Amber for unsynced local trail
          'line-width': 3,
          'line-dasharray': [1, 2],
          'line-opacity': 0.9
        }
      });
    });
      } catch (err) {
        console.error("Error initializing MapLibre:", err);
      }
    };
    
    initMap();
  }, [onUserLocationUpdate]); // added dep

  // Update Draw Layer Data
  useEffect(() => {
    if (!map.current || !map.current.getSource('draw-data')) return;
    (map.current.getSource('draw-data') as maplibregl.GeoJSONSource).setData(drawnFeatures);
  }, [drawnFeatures]);

  // Handle Mode Change Cleanup
  useEffect(() => {
    if (drawMode !== 'flood') {
      // Solidify active polygon
      setDrawnFeatures(prev => {
        const features = prev.features.map(f => {
          if (f.properties?.id === 'active-poly') {
            f.properties.id = 'final-poly';
          }
          return f;
        });
        return { ...prev, features };
      });
      currentPolygonCoords.current = [];
    }
  }, [drawMode]);

  // Handle Drawing Inputs (Mouse, Touch, Keyboard)
  const addCoordinate = useCallback((coords: [number, number]) => {
    if (drawMode === 'risk') {
      setDrawnFeatures(prev => ({
        ...prev,
        features: [...prev.features, {
          type: 'Feature',
          properties: { type: 'risk' },
          geometry: { type: 'Point', coordinates: coords }
        }]
      }));
      setDrawMode('none');
    } else if (drawMode === 'flood') {
      currentPolygonCoords.current = [...currentPolygonCoords.current, coords];
      
      const closedCoords = [...currentPolygonCoords.current];
      if (closedCoords.length >= 3) closedCoords.push(closedCoords[0]);

      const newPoly: GeoJSON.Feature = {
        type: 'Feature',
        properties: { type: 'flood', id: 'active-poly' },
        geometry: {
          type: 'Polygon',
          coordinates: [closedCoords]
        }
      };

      setDrawnFeatures(prev => {
        const features = prev.features.filter(f => f.properties?.id !== 'active-poly');
        return { ...prev, features: [...features, newPoly] };
      });
    }
  }, [drawMode]);

  useEffect(() => {
    if (!map.current) return;

    const clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (drawMode === 'none' && !onMapClick) return;

      const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (onMapClick) {
        onMapClick(coords);
      }
      if (drawMode !== 'none') {
        addCoordinate(coords);
      }
    };

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (drawMode === 'none' && !onMapClick) return;
        
        e.preventDefault();
        const center = map.current!.getCenter();
        const coords: [number, number] = [center.lng, center.lat];
        
        if (onMapClick) {
          onMapClick(coords);
        }
        if (drawMode !== 'none') {
          addCoordinate(coords);
        }
      }
    };

    map.current.on('click', clickHandler);
    window.addEventListener('keydown', keyHandler);

    return () => {
      map.current?.off('click', clickHandler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, [drawMode, addCoordinate, onMapClick]);

  // Update Markers when victims change
  useEffect(() => {
    if (!map.current) return;

    Object.values(markersRef.current).forEach(marker => marker.remove());
    markersRef.current = {};

    // 1. Render Rescue Points (Victims) - Must be Red
    victims.forEach(victim => {
      const el = document.createElement('div');
      
      // Always red for rescue points per user requirement
      el.className = 'w-5 h-5 bg-red-600 border-[2.5px] border-white rounded-full shadow-md cursor-pointer transition-transform hover:scale-125';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(victim.coordinates)
        .addTo(map.current!);
        
      markersRef.current[victim.id] = marker;
    });

    // 2. Render Rescue Shelters (Safe Zones) - Must be Green
    SAFE_ZONES.forEach(sz => {
      const el = document.createElement('div');
      el.className = 'w-6 h-6 bg-green-600 border-[2px] border-white rounded shadow-md flex items-center justify-center';
      el.innerHTML = '<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>';
      
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(sz.coordinates)
        .addTo(map.current!);
        
      markersRef.current[sz.id] = marker;
    });

    // 3. Render Anomalies
    anomalies.forEach(anomaly => {
      const el = document.createElement('div');
      el.className = 'w-7 h-7 bg-amber-500 border-[2.5px] border-white rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:bg-amber-600 animate-pulse';
      el.title = `Hazard: ${anomaly.type} - Click to Clear`;
      el.innerHTML = '<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
      
      el.onclick = (e) => {
        e.stopPropagation();
        if (onDeleteAnomaly) onDeleteAnomaly(anomaly.id);
      };

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(anomaly.coordinates)
        .addTo(map.current!);
        
      markersRef.current[anomaly.id] = marker;
    });
  }, [victims, anomalies, onDeleteAnomaly]);

  // Fly to selected victim
  useEffect(() => {
    if (!map.current || !selectedVictimId) return;
    const targetVictim = victims.find(v => v.id === selectedVictimId);
    if (targetVictim) {
      map.current.flyTo({
        center: targetVictim.coordinates,
        zoom: 14,
        speed: 1.2,
        curve: 1.42,
        easing: (t) => t
      });
    }
  }, [selectedVictimId, victims]);

  // Update Route Trace
  useEffect(() => {
    if (!map.current || !map.current.getSource('active-route')) return;
    const source = map.current.getSource('active-route') as maplibregl.GeoJSONSource;
    if (activeRoute.length > 0) {
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: activeRoute }
        }]
      });
    } else {
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [activeRoute]);

  // Update Breadcrumbs & Local Trail
  useEffect(() => {
    if (!map.current) return;
    const breadcrumbSource = map.current.getSource('mesh-breadcrumbs') as maplibregl.GeoJSONSource;
    if (breadcrumbSource && breadcrumbs.length > 0) {
      breadcrumbSource.setData({
        type: 'FeatureCollection',
        features: breadcrumbs.map((trail, i) => ({
          type: 'Feature',
          properties: { id: i },
          geometry: { type: 'LineString', coordinates: trail }
        }))
      });
    }

    const localSource = map.current.getSource('local-trail') as maplibregl.GeoJSONSource;
    if (localSource && localTrail.length > 1) {
      localSource.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: localTrail }
        }]
      });
    } else if (localSource) {
      localSource.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [breadcrumbs, localTrail]);

  return (
    <div className="relative w-full h-full">
      {/* MapLibre Container */}
      <div ref={mapContainer} className="w-full h-full absolute inset-0 bg-[#e8eaed]" />

      {/* Drawing Toolbar (Keyboard & Touch Accessible) */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-3">
        <button 
          tabIndex={1}
          className={`min-h-[48px] min-w-[140px] px-5 py-2.5 rounded-full font-bold text-sm shadow-lg transition-all focus:ring-4 focus:ring-blue-300 outline-none ${drawMode === 'flood' ? 'bg-blue-600 text-white scale-105 border-2 border-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}
          onClick={() => setDrawMode(drawMode === 'flood' ? 'none' : 'flood')}
        >
          {drawMode === 'flood' ? 'Finish Flood Zone' : 'Mark Flood Zone'}
        </button>
        <button 
          tabIndex={2}
          className={`min-h-[48px] min-w-[140px] px-5 py-2.5 rounded-full font-bold text-sm shadow-lg transition-all focus:ring-4 focus:ring-red-300 outline-none ${drawMode === 'risk' ? 'bg-black text-white scale-105 border-2 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'bg-white text-gray-800 hover:bg-gray-50'}`}
          onClick={() => setDrawMode(drawMode === 'risk' ? 'none' : 'risk')}
        >
          Mark Rescue Risk
        </button>

        {localTrail.length > 1 && (
          <button 
            className="min-h-[48px] min-w-[140px] px-5 py-2.5 rounded-full font-bold text-sm shadow-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all border-2 border-white animate-pulse"
            onClick={onBroadcastTrail}
          >
            Broadcast Trail to Mesh
          </button>
        )}
        
        {drawMode !== 'none' && (
          <div className="bg-gray-900/80 text-white text-xs px-4 py-2 rounded-lg mt-2 shadow-sm font-medium">
            Tap map or press <strong>Spacebar</strong> to place points.
          </div>
        )}
      </div>
      
      {/* Subtle Fallback Targeting Crosshair */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10 overflow-hidden">
        <div className="relative flex items-center justify-center text-gray-500/50 drop-shadow-sm">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </div>
      </div>
    </div>
  );
}

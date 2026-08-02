import { useEffect, useState, useRef } from 'react';
import ChaosTesting from '../webfunctions/diagnostics/ChaosTesting';
import Map from './components/Map';
import TriageDashboard from './components/TriageDashboard';
import OpticalSync from './components/OpticalSync';

import { rankVictims } from '../webfunctions/math/triage';
import type { Victim, TriageStatus } from '../webfunctions/math/triage';
import type { Coordinate } from '../webfunctions/math/pathfinding';
import { encode, decode } from '@msgpack/msgpack';
import simplify from '@turf/simplify';
import { sharedVictims, sharedAnomalies, sharedAssets, sharedBreadcrumbs, sharedDrawnFeatures, onSyncStatusChange } from '../webfunctions/sync/mesh';
import { useCallback } from 'react';

function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

type Notification = { id: string; message: string; type: 'info' | 'success' | 'warning' };

export default function App() {
  const [victims, setVictims] = useState<(Victim & { score: number, coordinates: [number, number] })[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [drawnFeatures, setDrawnFeatures] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const [assets, setAssets] = useState<{id: string, name: string}[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Coordinate[][]>([]);
  const [localTrail, setLocalTrail] = useState<Coordinate[]>([]);
  const lastRecordedRef = useRef<Coordinate | null>(null);
  
  const [selectedVictimId, setSelectedVictimId] = useState<string | null>(null);
  const [activeRoutingRequest, setActiveRoutingRequest] = useState<{victimId: string, resources: string[]} | null>(null);
  const [activeRoute, setActiveRoute] = useState<Coordinate[]>([]);
  const [routeStats, setRouteStats] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [isDbReady, setIsDbReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [syncBuffer, setSyncBuffer] = useState<Uint8Array>(new Uint8Array());
  const [isMeshSynced, setIsMeshSynced] = useState(false);
  const [isOffGridModalOpen, setIsOffGridModalOpen] = useState(false);
  const [bootState, setBootState] = useState<'CHECKING_MAP' | 'LOADING_MAP' | 'CHECKING_SERVER' | 'PROMPT_OFF_GRID' | 'READY'>('CHECKING_MAP');
  const [mapLoadProgress, setMapLoadProgress] = useState(0);
  const [isRouting, setIsRouting] = useState(false);
  
  // Custom Targeting State
  const [isTargetingMode, setIsTargetingMode] = useState(false);
  const [isGeolocationFailed, setIsGeolocationFailed] = useState(false);
  const [isSettingManualLocation, setIsSettingManualLocation] = useState(false);
  const [isManualLocationSet, setIsManualLocationSet] = useState(false);
  const [draftEvent, setDraftEvent] = useState({
    type: 'VICTIM',
    name: 'Field Report',
    severity: 5,
    partySize: 1,
    hazardType: 'GAS_LEAK'
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pathWorker = useRef<Worker | null>(null);
  const sqliteWorkerRef = useRef<Worker | null>(null);
  const routingRequestRef = useRef<any>(null);

  const notify = (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  useEffect(() => {
    // Determine initial sidebar state based on screen size
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }

    const sqliteWorker = new Worker(new URL('../webfunctions/workers/sqlite.worker.ts', import.meta.url), { type: 'module' });
    sqliteWorkerRef.current = sqliteWorker;

    sqliteWorker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'DB_READY') {
        setIsDbReady(true);
        setBootState('LOADING_MAP');
        fetch('/odisha_state_graph.geojson') // 100km radius graph
          .then(res => res.json())
          .then((data) => {
            sqliteWorker.postMessage({ type: 'LOAD_MAP_CHUNK', payload: data });
          });
      } else if (type === 'CHUNK_LOADED') {
        setMapLoadProgress(100);
        notify(`Map module loaded: ${payload.nodeCount} nodes indexed.`, 'success');
        setBootState('CHECKING_SERVER');
        setTimeout(() => {
          setBootState(prev => prev === 'CHECKING_SERVER' ? 'PROMPT_OFF_GRID' : prev);
        }, 3000);
      } else if (type === 'CHUNK_PROGRESS') {
        const { current, total } = payload;
        setMapLoadProgress(Math.floor((current / total) * 100));
      } else if (type === 'BBOX_GRAPH_RESULT') {
        if (pathWorker.current) {
          pathWorker.current.postMessage({ type: 'GRAPH_BUILT', payload: { adjacencyList: payload.adjacencyList } });
          if (routingRequestRef.current) {
            pathWorker.current.postMessage({
              type: 'CALCULATE_ROUTE',
              payload: routingRequestRef.current
            });
            routingRequestRef.current = null;
          }
        }
      }
    };

    pathWorker.current = new Worker(new URL('../webfunctions/math/pathfinding.worker.ts', import.meta.url), { type: 'module' });
    
    pathWorker.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'ROUTE_CALCULATED') {
        const { insertionRoute, extractionRoute, safeZone } = payload;
        
        let combinedPath: Coordinate[] = [...insertionRoute.path];
        if (extractionRoute) {
          combinedPath = [...combinedPath, ...extractionRoute.path];
        }
        
        setActiveRoute(combinedPath);
        setRouteStats({ insertion: insertionRoute, extraction: extractionRoute, safeZone });
        
        setIsRouting(false);
        // Auto-close sidebar on mobile after selecting a route so user can see the map
        if (window.innerWidth < 768) {
          setIsSidebarOpen(false);
        }
      } else if (type === 'ROUTE_ERROR') {
        notify('Routing failed. Graph isolated.', 'warning');
        setActiveRoute([]);
        setRouteStats(null);
        setIsRouting(false);
      }
    };

    // --- DECENTRALIZED MESH SYNC LOGIC ---
    const updateReactStateFromMesh = () => {
      const currentVictims = sharedVictims.toArray() as (Victim & { score: number, coordinates: [number, number] })[];
      const ranked = rankVictims(currentVictims, { id: 'v1', capacity: 4 }) as (Victim & { score: number, coordinates: [number, number] })[];
      setVictims(ranked);
    };
    
    const updateAnomaliesFromMesh = () => setAnomalies(sharedAnomalies.toArray());
    const updateAssetsFromMesh = () => {
      const arr = sharedAssets.toArray() as { id: string; name: string }[];
      setAssets(arr);
    };
    const updateBreadcrumbsFromMesh = () => {
      const arr = sharedBreadcrumbs.toArray() as Coordinate[][];
      setBreadcrumbs(arr);
    };
    const updateDrawnFeaturesFromMesh = () => {
      const arr = sharedDrawnFeatures.toArray() as GeoJSON.Feature[];
      setDrawnFeatures({ type: 'FeatureCollection', features: arr });
    };

    sharedVictims.observe(updateReactStateFromMesh);
    sharedAnomalies.observe(updateAnomaliesFromMesh);
    sharedAssets.observe(updateAssetsFromMesh);
    sharedBreadcrumbs.observe(updateBreadcrumbsFromMesh);
    sharedDrawnFeatures.observe(updateDrawnFeaturesFromMesh);
    
    // Check network sync status
    onSyncStatusChange((synced) => {
      setIsMeshSynced(synced);
      if (synced) {
        setBootState(prev => (prev === 'CHECKING_SERVER' || prev === 'PROMPT_OFF_GRID') ? 'READY' : prev);
      }
    });

    // Initial manual read
    updateReactStateFromMesh();
    updateAnomaliesFromMesh();
    updateAssetsFromMesh();
    updateBreadcrumbsFromMesh();
    updateDrawnFeaturesFromMesh();

    const spatialWorker = new Worker(new URL('../webfunctions/workers/spatial.worker.ts', import.meta.url), { type: 'module' });
    
    return () => {
      sqliteWorker.terminate();
      spatialWorker.terminate();
      pathWorker.current?.terminate();
    };
  }, []);

  useEffect(() => {
    setActiveRoutingRequest(null);
    setActiveRoute([]);
    setRouteStats(null);
    setIsRouting(false);
  }, [selectedVictimId]);

  useEffect(() => {
    if (activeRoutingRequest && pathWorker.current && sqliteWorkerRef.current) {
      const target = victims.find(v => v.id === activeRoutingRequest.victimId);
      if (target) {
        let origin: Coordinate = [85.8245, 20.2961];
        
        if (userLocation) {
          const distToCity = getDistanceFromLatLonInMeters(20.2961, 85.8245, userLocation[1], userLocation[0]);
          if (distToCity > 100000) {
            origin = [85.8245, 20.2961];
          } else {
            origin = userLocation;
          }
        }

        const minLon = Math.min(origin[0], target.coordinates[0]) - 1.0;
        const maxLon = Math.max(origin[0], target.coordinates[0]) + 1.0;
        const minLat = Math.min(origin[1], target.coordinates[1]) - 1.0;
        const maxLat = Math.max(origin[1], target.coordinates[1]) + 1.0;

        sqliteWorkerRef.current.postMessage({
          type: 'GET_BBOX_GRAPH',
          payload: { minLon, maxLon, minLat, maxLat }
        });

        routingRequestRef.current = { 
          start: origin, 
          target: target.coordinates, 
          anomalies, 
          breadcrumbs, 
          drawnFeatures,
          resources: activeRoutingRequest.resources
        };
      }
    } else if (!activeRoutingRequest) {
      setActiveRoute([]);
      setRouteStats(null);
      setIsRouting(false);
    }
  }, [activeRoutingRequest, victims, userLocation, anomalies, breadcrumbs, drawnFeatures]);

  // Breadcrumb Trail Recording Logic
  useEffect(() => {
    if (userLocation) {
      if (!lastRecordedRef.current || getDistanceFromLatLonInMeters(userLocation[1], userLocation[0], lastRecordedRef.current[1], lastRecordedRef.current[0]) > 25) {
        lastRecordedRef.current = userLocation;
        setLocalTrail(prev => [...prev, userLocation]);
      }
    }
  }, [userLocation]);

  // Generate dynamic QR sync payload (serialize current triage queue and drawn features)
  useEffect(() => {
    if (victims.length > 0 || drawnFeatures.features.length > 0 || breadcrumbs.length > 0) {
      // Serialize a subset of critical data to keep it efficient
      const criticalData = victims.map(v => ({ id: v.id, name: v.name, severity: v.severity, partySize: v.partySize, score: v.score, coords: v.coordinates }));
      
      // Simplify polygons for QR density limits
      const simplifiedFeatures = drawnFeatures.features.map(f => {
        if (f.geometry.type === 'Polygon') {
          const coords = (f.geometry as GeoJSON.Polygon).coordinates;
          if (coords && coords[0] && coords[0].length >= 4) {
            try {
              return simplify(f as any, { tolerance: 0.0001, highQuality: false });
            } catch (e) {
              return f;
            }
          }
        }
        return f;
      });

      setSyncBuffer(encode({ victims: criticalData, features: simplifiedFeatures, trails: breadcrumbs }));
    }
  }, [victims, drawnFeatures, breadcrumbs]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sqliteWorkerRef.current) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        sqliteWorkerRef.current!.postMessage({ type: 'LOAD_MAP_CHUNK', payload: data });
        notify('Processing Map Module...', 'info');
      } catch (err) {
        notify('Invalid Map Chunk format.', 'warning');
      }
    };
    reader.readAsText(file);
  };

  // Decode incoming payload
  const handlePayloadReceived = (data: Uint8Array) => {
    try {
      const decodedData = decode(data) as { victims?: any[], features?: any[], trails?: any[] } | any[];
      let incomingVictims: any[] = [];
      let incomingFeatures: any[] = [];
      
      let incomingTrails: any[] = [];
      
      if (Array.isArray(decodedData)) {
        incomingVictims = decodedData; // backwards compatibility
      } else {
        incomingVictims = decodedData.victims || [];
        incomingFeatures = decodedData.features || [];
        incomingTrails = decodedData.trails || [];
      }

      let addedVictims = 0;
      let addedFeatures = 0;
      let addedTrails = 0;
      const currentVictimIds = new Set(sharedVictims.toArray().map((v: any) => v.id));
      const currentFeatureIds = new Set(sharedDrawnFeatures.toArray().map((f: any) => f.properties?.id));
      const currentTrailsStr = new Set(sharedBreadcrumbs.toArray().map((t: any) => JSON.stringify(t)));
      
      incomingVictims.forEach((incoming: any) => {
        if (!currentVictimIds.has(incoming.id)) {
          sharedVictims.push([{
            id: incoming.id,
            name: incoming.name,
            severity: incoming.severity,
            waterRisk: 0,
            partySize: incoming.partySize || 1,
            vulnerability: 1.0,
            distanceMeters: getDistanceFromLatLonInMeters(20.2961, 85.8245, incoming.coords[1], incoming.coords[0]),
            coordinates: incoming.coords,
            score: incoming.score || 0
          }]);
          addedVictims++;
        }
      });
      
      incomingFeatures.forEach((incomingFeature: any) => {
        if (incomingFeature.properties?.id && !currentFeatureIds.has(incomingFeature.properties.id)) {
          sharedDrawnFeatures.push([incomingFeature]);
          addedFeatures++;
        }
      });
      
      incomingTrails.forEach((incomingTrail: any) => {
        if (!currentTrailsStr.has(JSON.stringify(incomingTrail))) {
           sharedBreadcrumbs.push([incomingTrail]);
           addedTrails++;
        }
      });
      
      if (addedVictims > 0 || addedFeatures > 0 || addedTrails > 0) {
        notify(`Optical Sync: Synced ${addedVictims} incident(s), ${addedFeatures} hazard(s), and ${addedTrails} trail(s).`, 'success');
      } else {
        notify(`Optical Sync: Checked payload, no new data found.`, 'info');
      }
    } catch (e) {
      console.error('Failed to decode QR payload', e);
      notify('Failed to decode QR payload data.', 'warning');
    }
  };

  const handleMapClick = useCallback((coords: [number, number]) => {
    if (isSettingManualLocation) {
      setUserLocation(coords);
      setIsManualLocationSet(true);
      setIsSettingManualLocation(false);
      notify('Manual location set successfully.', 'success');
      return;
    }

    if (!isTargetingMode) return;
    
    if (draftEvent.type === 'VICTIM') {
      sharedVictims.push([{
        id: Math.random().toString(),
        name: draftEvent.name || 'UNKNOWN INCIDENT',
        severity: draftEvent.severity,
        waterRisk: 0,
        partySize: draftEvent.partySize,
        vulnerability: 1.5,
        distanceMeters: getDistanceFromLatLonInMeters(20.2961, 85.8245, coords[1], coords[0]),
        coordinates: coords,
        score: 0
      }]);
      notify('Target Locked. Priority Synced to Mesh.', 'success');
    } else {
      sharedAnomalies.push([{
        id: Math.random().toString(),
        type: draftEvent.hazardType,
        coordinates: coords
      }]);
      notify('Hazard Coordinates Synced to Mesh.', 'warning');
    }
    
    setIsTargetingMode(false);
  }, [isSettingManualLocation, isTargetingMode, draftEvent]);

  const handleDeleteVictim = (id: string) => {
    const arr = sharedVictims.toArray() as { id: string }[];
    const index = arr.findIndex(v => v.id === id);
    if (index > -1) {
      sharedVictims.delete(index, 1);
      notify('Entry deleted from Mesh.', 'info');
    }
  };

  const handleDeleteAnomaly = (id: string) => {
    const arr = sharedAnomalies.toArray() as { id: string }[];
    const index = arr.findIndex(v => v.id === id);
    if (index > -1) {
      sharedAnomalies.delete(index, 1);
      notify('Hazard cleared from Mesh.', 'info');
    }
  };

  const handleUpdateStatus = (id: string, status: TriageStatus) => {
    const arr = sharedVictims.toArray() as Victim[];
    const index = arr.findIndex(v => v.id === id);
    if (index > -1) {
      const updatedVictim = { ...arr[index], status };
      sharedVictims.delete(index, 1);
      sharedVictims.insert(index, [updatedVictim]);
      notify(`Status updated to ${status}`, 'success');
    }
  };

  const handleAddAsset = (name: string) => {
    sharedAssets.push([{ id: Math.random().toString(), name }]);
    notify('Asset logged to mesh.', 'success');
  };

  const handleBroadcastTrail = () => {
    if (localTrail.length > 1) {
      sharedBreadcrumbs.push([localTrail]);
      setLocalTrail([localTrail[localTrail.length - 1]]); // Keep last point as start of next segment
      notify('Path broadcasted to mesh graph!', 'success');
    }
  };

  return (
    <div className="flex h-screen text-gray-800 overflow-hidden relative font-sans selection:bg-blue-500/30 bg-[#e8eaed]">
      {bootState !== 'READY' && (
        <div className="absolute inset-0 z-[100] bg-gray-900 flex items-center justify-center text-white p-6 overflow-y-auto">
          <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-start my-auto">
            {/* Left Column: Loading Status */}
            <div className="p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 flex flex-col justify-center">
              <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
                AapdaSync Node
              </h1>
            
            <div className="space-y-4 text-sm font-medium text-gray-400">
              <div className={`flex items-center gap-3 ${bootState === 'CHECKING_MAP' ? 'text-white' : 'text-emerald-400'}`}>
                <span>{bootState === 'CHECKING_MAP' ? '•' : '✓'}</span> Checking OPFS Storage
              </div>
              <div className={`flex items-center gap-3 ${bootState === 'LOADING_MAP' ? 'text-white' : (bootState === 'CHECKING_SERVER' || bootState === 'PROMPT_OFF_GRID') ? 'text-emerald-400' : ''}`}>
                <span>{(bootState === 'CHECKING_SERVER' || bootState === 'PROMPT_OFF_GRID') ? '✓' : '•'}</span> Injecting Map Modules
              </div>
              {bootState === 'LOADING_MAP' && (
                <div className="w-full h-2 bg-gray-700 rounded-full mt-2 overflow-hidden relative">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${mapLoadProgress}%` }}
                  ></div>
                </div>
              )}
              <div className={`flex items-center gap-3 ${bootState === 'CHECKING_SERVER' ? 'text-white animate-pulse' : ''}`}>
                <span>{bootState === 'PROMPT_OFF_GRID' ? '✗' : '•'}</span> Handshaking WebRTC Mesh
              </div>
            </div>

              {bootState === 'PROMPT_OFF_GRID' && (
                <div className="mt-8 p-5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <h3 className="text-amber-500 font-bold mb-2">Mesh Servers Unreachable</h3>
                  <p className="text-xs text-amber-200/80 mb-5 leading-relaxed">No internet connection detected. You must operate off-grid using Optical (QR) Sync.</p>
                  <button 
                    onClick={() => setBootState('READY')}
                    className="w-full py-3 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700 shadow-md transition-colors"
                  >
                    Acknowledge Off-Grid Mode
                  </button>
                </div>
              )}
            </div>

            {/* Right Column: User Guide */}
            <div className="p-8 bg-gray-800/50 rounded-2xl border border-gray-700 max-h-[70vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-blue-400 mb-4 sticky top-0 bg-gray-800/90 py-2 border-b border-gray-700 backdrop-blur-sm z-10">Tactical Field Guide</h2>
              
              <div className="space-y-6 text-sm text-gray-300">
                <section>
                  <h3 className="text-white font-semibold flex items-center gap-2 mb-2">
                    <span className="text-blue-500">1.</span> Mapping & Tracking
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-gray-300">
                    <li><strong>Field Reports:</strong> Use the Priority Manifest to log victims, hazards (e.g., floods, gas leaks), and active assets.</li>
                    <li><strong>Custom Pins:</strong> You can drop custom markers for rescue shelters, hazard zones, or manually set your own GPS location if your hardware fails to lock onto satellites.</li>
                  </ul>
                </section>
                
                <section>
                  <h3 className="text-white font-semibold flex items-center gap-2 mb-2">
                    <span className="text-emerald-500">2.</span> Tactical Routing & Transport
                  </h3>
                  <p className="leading-relaxed mb-2">Select a victim in the manifest and tap "Plot Rescue Route" to invoke the onboard A* engine over the massive offline road graph.</p>
                  <ul className="list-disc pl-5 space-y-1 text-gray-300">
                    <li><strong>Dynamic Hazard Avoidance:</strong> The router actively avoids user-marked flood zones and pit-like areas by dynamically increasing their traversal cost.</li>
                    <li><strong>Off-Road Fallback:</strong> If a victim is isolated from the main highway grid, the router will automatically stitch an off-grid vector to the nearest accessible road.</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-white font-semibold flex items-center gap-2 mb-2">
                    <span className="text-amber-500">3.</span> Optical Sync (QR Air-Gapping)
                  </h3>
                  <p className="leading-relaxed">When the WebRTC Mesh completely fails in deep dead zones, use <strong>Optical Sync</strong>. Click <strong>Transmit</strong> to serialize your local state into a high-density QR payload. Another operative can click <strong>Receive</strong> to scan and seamlessly merge the databases offline.</p>
                </section>

                <section>
                  <h3 className="text-white font-semibold flex items-center gap-2 mb-2">
                    <span className="text-rose-500">4.</span> Critical Hardware Warnings
                  </h3>
                  <ul className="list-disc pl-5 space-y-2 text-gray-400">
                    <li><strong>Battery Savers:</strong> Aggressive OS-level battery optimizers (common on Android tablets) will assassinate the routing Web Workers mid-calculation. Whitelist the browser immediately!</li>
                    <li><strong>GPS Drift:</strong> Internal tablet GPS is inaccurate under canopy. We highly recommend pairing via Bluetooth to an external GNSS receiver (e.g., Garmin GLO 2).</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
      <ChaosTesting />
      
      {/* Toast Notification Container */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[90%] max-w-[400px]">
        {notifications.map(n => (
          <div key={n.id} className={`p-4 rounded-xl shadow-lg flex items-center gap-3 transform transition-all pointer-events-auto border-l-4 
            ${n.type === 'success' ? 'bg-white border-emerald-500 text-gray-800' : 
              n.type === 'warning' ? 'bg-amber-50 border-amber-500 text-amber-900' : 
              'bg-gray-900 border-blue-500 text-white'}`}>
            <span className="text-sm font-semibold tracking-wide">{n.message}</span>
          </div>
        ))}
      </div>

      {/* Map Area */}
      <div className="w-full h-full relative z-0">
        <Map 
          victims={victims} 
          anomalies={anomalies}
          breadcrumbs={breadcrumbs}
          localTrail={localTrail}
          selectedVictimId={selectedVictimId} 
          activeRoute={activeRoute} 
          userLocation={userLocation}
          isGeolocationFailed={isGeolocationFailed}
          drawnFeatures={drawnFeatures}
          onUpdateDrawnFeatures={(features) => {
            const currentIds = new Set(sharedDrawnFeatures.toArray().map((f: any) => f.properties?.id));
            features.features.forEach((feature) => {
              if (feature.properties?.id && !currentIds.has(feature.properties.id)) {
                sharedDrawnFeatures.push([feature]);
              }
            });
            setDrawnFeatures(features);
          }}
          onUserLocationUpdate={(coord) => {
            if (!isManualLocationSet) {
              setUserLocation(coord);
            }
          }}
          onGeolocationError={() => setIsGeolocationFailed(true)}
          onMapClick={handleMapClick}
          onDeleteAnomaly={handleDeleteAnomaly}
          onBroadcastTrail={handleBroadcastTrail}
          onEnableManualLocation={() => setIsSettingManualLocation(true)}
          isManualLocation={isManualLocationSet}
        />
      </div>

      {/* Geolocation Fallback Banner */}
      {isGeolocationFailed && !isSettingManualLocation && !isManualLocationSet && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-amber-500 text-white px-6 py-3 rounded-full shadow-2xl font-bold text-sm tracking-wide flex items-center gap-3 cursor-pointer hover:bg-amber-600 transition-colors" onClick={() => setIsSettingManualLocation(true)}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          GPS Failed. Click to set manual location.
        </div>
      )}

      {/* Manual Location Active Banner */}
      {isManualLocationSet && !isSettingManualLocation && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-blue-600/90 backdrop-blur-md text-white px-5 py-2 rounded-full shadow-lg font-bold text-xs tracking-wide flex items-center gap-2 cursor-pointer hover:bg-blue-700 transition-colors border border-blue-400" onClick={() => setIsSettingManualLocation(true)}>
          <div className="w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_8px_#34d399]"></div>
          Manual GPS Active. Click to update.
        </div>
      )}

      {/* Manual Location Target Mode */}
      {isSettingManualLocation && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-blue-600 text-white px-8 py-3 rounded-full shadow-2xl font-mono text-sm tracking-widest uppercase flex items-center gap-3 animate-pulse cursor-pointer border-2 border-blue-400" onClick={() => setIsSettingManualLocation(false)}>
          <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
          Pan & Press Spacebar (or Tap) to set your location
          <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
        </div>
      )}

      {/* Targeting Mode Banner */}
      {isTargetingMode && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-red-600 text-white px-8 py-3 rounded-full shadow-2xl font-mono text-sm tracking-widest uppercase flex items-center gap-3 animate-pulse cursor-pointer border-2 border-red-400" onClick={() => setIsTargetingMode(false)}>
          <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
          Targeting Engaged - Pan & Press Spacebar (or Tap) to Drop Pin
          <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
        </div>
      )}

      {/* Off-Grid Mode Modal */}
      {isOffGridModalOpen && !isTargetingMode && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Off-Grid Field Entry</h2>
            <p className="text-sm text-gray-500 mb-6">Configure custom parameters, then mark location on the tactical map.</p>
            
            <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
              <button 
                onClick={() => setDraftEvent(prev => ({ ...prev, type: 'VICTIM' }))}
                className={`flex-1 py-2 text-sm font-bold rounded-md ${draftEvent.type === 'VICTIM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
              >
                Triage Event
              </button>
              <button 
                onClick={() => setDraftEvent(prev => ({ ...prev, type: 'HAZARD' }))}
                className={`flex-1 py-2 text-sm font-bold rounded-md ${draftEvent.type === 'HAZARD' ? 'bg-white shadow-sm text-red-600' : 'text-gray-500'}`}
              >
                Hazard Anomaly
              </button>
            </div>

            <div className="space-y-4">
              {draftEvent.type === 'VICTIM' ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-1">Event Designation</label>
                    <input 
                      type="text" 
                      value={draftEvent.name}
                      onChange={e => setDraftEvent(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1">Severity (1-10)</label>
                      <input 
                        type="number" min="1" max="10" 
                        value={draftEvent.severity}
                        onChange={e => setDraftEvent(prev => ({ ...prev, severity: parseInt(e.target.value) || 5 }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-gray-600 mb-1">Party Size</label>
                      <input 
                        type="number" min="1" 
                        value={draftEvent.partySize}
                        onChange={e => setDraftEvent(prev => ({ ...prev, partySize: parseInt(e.target.value) || 1 }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Anomaly Type</label>
                  <select 
                    value={draftEvent.hazardType}
                    onChange={e => setDraftEvent(prev => ({ ...prev, hazardType: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="GAS_LEAK">Gas Pipeline Leak</option>
                    <option value="FLOOD">Flash Flood</option>
                    <option value="COLLAPSE">Structural Collapse</option>
                  </select>
                </div>
              )}
              
              <button 
                onClick={() => {
                  setIsOffGridModalOpen(false);
                  setIsTargetingMode(true);
                  if (window.innerWidth < 768) setIsSidebarOpen(false);
                }}
                className={`w-full py-3.5 mt-2 font-bold rounded-xl border transition-colors flex items-center justify-center gap-2 ${draftEvent.type === 'VICTIM' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-red-600 text-white hover:bg-red-700'}`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                Select Location on Map
              </button>
            </div>
            
            <button 
              onClick={() => setIsOffGridModalOpen(false)}
              className="mt-6 w-full py-3 text-gray-500 font-bold hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Floating Action Button for Sidebar (Mobile & Desktop) */}
      {!isSidebarOpen && (
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="absolute top-4 left-4 z-10 bg-white p-3 md:p-4 rounded-full md:rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-gray-100 text-gray-800 hover:bg-gray-50 focus:ring-4 focus:ring-blue-100 outline-none transition-transform active:scale-95"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      )}

      {/* Collapsible Responsive Drawer */}
      <div className={`
        absolute z-20 flex flex-col bg-white shadow-2xl overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        ${isSidebarOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full md:-translate-x-[110%] md:translate-y-0 opacity-0 pointer-events-none'}
        bottom-0 left-0 right-0 w-full rounded-t-3xl max-h-[85vh]
        md:bottom-auto md:top-4 md:left-4 md:right-auto md:w-[400px] md:rounded-2xl md:max-h-[calc(100vh-32px)]
      `}>
        <header className="px-6 py-4 flex items-center gap-4 border-b border-gray-100 bg-white sticky top-0 z-10">
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors focus:ring-2 focus:ring-gray-200 outline-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          
          <div className="flex-1">
            <h1 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-tight flex items-center gap-2">
              AapdaSync 
              <span className={`w-2 h-2 rounded-full ${isMeshSynced ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500 animate-pulse'}`} title={isMeshSynced ? 'Mesh Connected' : 'Mesh Offline'} />
            </h1>
            <p className="text-[11px] md:text-xs text-gray-500 font-medium uppercase tracking-wider">
              Operations Center
            </p>
          </div>
          
          <button 
            onClick={() => setIsOffGridModalOpen(true)}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-gray-800 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            LOG
          </button>
        </header>

        <div className="flex-1 flex flex-col overflow-y-auto">
          <TriageDashboard 
            victims={victims} 
            selectedVictimId={selectedVictimId} 
            onSelectVictim={setSelectedVictimId}
            onDeleteVictim={handleDeleteVictim}
            onUpdateStatus={handleUpdateStatus}
            onPlotRoute={(victimId, resources) => {
              setRouteStats(null);
              setIsRouting(true);
              setActiveRoutingRequest({ victimId, resources });
            }}
            routeStats={routeStats}
            anomalies={anomalies}
            assets={assets}
            onAddAsset={handleAddAsset}
            isRouting={isRouting}
          />
          
          <div className="p-6 bg-gray-50 border-t border-gray-100 pb-8 md:pb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                OPFS Modules
              </h3>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isDbReady ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                <span className="text-[10px] font-bold text-gray-500">{isDbReady ? 'ONLINE' : 'BOOTING'}</span>
              </div>
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={!isDbReady}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 shadow-sm text-sm font-semibold text-gray-700 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed outline-none focus:ring-2 focus:ring-blue-500"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Inject Map Chunk
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".geojson,.json" 
              onChange={handleFileUpload} 
            />
          </div>

          <div className="p-6 bg-white border-t border-gray-100 pb-12 md:pb-6">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Mesh Sync
            </h3>
            <OpticalSync payloadBuffer={syncBuffer} onPayloadReceived={handlePayloadReceived} />
          </div>
        </div>
      </div>
    </div>
  )
}

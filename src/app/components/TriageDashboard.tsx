import type { Victim, TriageStatus } from '../../webfunctions/math/triage';
import type { RouteStats, Coordinate } from '../../webfunctions/math/pathfinding';

function getDistance(coord1: Coordinate, coord2: Coordinate): number {
  const R = 6371e3;
  const lat1 = coord1[1] * Math.PI / 180;
  const lat2 = coord2[1] * Math.PI / 180;
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface TriageDashboardProps {
  victims: (Victim & { score: number, coordinates: Coordinate })[];
  selectedVictimId?: string | null;
  onSelectVictim?: (victimId: string) => void;
  onDeleteVictim?: (victimId: string) => void;
  onUpdateStatus?: (victimId: string, status: TriageStatus) => void;
  routeStats?: { insertion: RouteStats, extraction: RouteStats | null, safeZone: any } | null;
  anomalies?: any[];
  assets?: { id: string, name: string }[];
  onAddAsset?: (name: string) => void;
}

export default function TriageDashboard({ victims, selectedVictimId, onSelectVictim, onDeleteVictim, onUpdateStatus, routeStats, anomalies, assets, onAddAsset }: TriageDashboardProps) {
  if (victims.length === 0) {
    return (
      <div className="p-8 text-center bg-white">
        <p className="text-gray-500 font-medium">No active incidents found in this area.</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col h-full bg-white">
      <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 sticky top-0 bg-white z-10">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">
          Priority Manifest
        </h2>
        <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">{victims.length} ACTIVE</span>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {victims.map((v) => {
          let priorityLabel = 'Stable';
          let textColor = 'text-emerald-700';
          let bgColor = 'bg-emerald-50';

          if (v.score >= 8.0) {
            priorityLabel = 'Critical';
            textColor = 'text-red-700';
            bgColor = 'bg-red-50';
          } else if (v.score >= 5.0) {
            priorityLabel = 'Urgent';
            textColor = 'text-amber-700';
            bgColor = 'bg-amber-50';
          }

          const isSelected = selectedVictimId === v.id;
          const selectionStyle = isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50';

          return (
            <div 
              key={v.id} 
              tabIndex={0}
              onClick={() => onSelectVictim?.(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectVictim?.(v.id);
                }
              }}
              className={`p-5 border-b border-gray-100 transition-colors duration-150 cursor-pointer outline-none focus:bg-gray-50 ${selectionStyle}`}
            >
              
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    {v.name}
                  </h3>
                  <div className="text-xs text-gray-500 mt-1.5 flex gap-3">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span className="font-medium text-gray-400">DIST</span> {(v.distanceMeters / 1000).toFixed(1)}km
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      <span className="font-medium text-gray-400">SEV</span> <span className="font-bold text-gray-700">{v.severity}/10</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                      <span className="font-medium text-gray-400">SZ</span> <span className="font-bold text-gray-700">{v.partySize}</span>
                    </span>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDeleteVictim?.(v.id); }}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Delete Entry"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                    <div className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md ${bgColor} ${textColor}`}>
                      {priorityLabel}
                    </div>
                  </div>
                  <div className="flex flex-col items-end mt-1">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Score</span>
                    <span className="text-sm font-bold text-gray-700">
                      {v.score.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Advanced Routing Stats & Status Expansion */}
              {isSelected && (
                <div className="mt-4 p-3 bg-white rounded-lg border border-gray-100 shadow-sm text-xs cursor-default" onClick={e => e.stopPropagation()}>
                  
                  {/* Status Control */}
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                    <span className="font-semibold text-gray-700">Lifecycle Status</span>
                    <select 
                      value={v.status || 'PENDING'}
                      onChange={(e) => onUpdateStatus?.(v.id, e.target.value as TriageStatus)}
                      className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs font-bold text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="PENDING">Pending</option>
                      <option value="DISPATCHED">Dispatched</option>
                      <option value="ON_SCENE">On Scene</option>
                      <option value="EXTRACTING">Extracting</option>
                      <option value="RESOLVED">Resolved (Archive)</option>
                    </select>
                  </div>

                  {/* Equipment Requirements */}
                  <div className="mb-3 pb-3 border-b border-gray-100">
                    <span className="font-semibold text-gray-700 block mb-2">Required Equipment</span>
                    <div className="flex flex-wrap gap-1.5">
                      {routeStats?.insertion.floodRiskWarnings ? <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold text-[10px] uppercase border border-blue-200">Boat / Amphibious</span> : null}
                      {v.partySize >= 5 ? <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold text-[10px] uppercase border border-purple-200">High-Capacity Transport</span> : <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold text-[10px] uppercase border border-gray-200">Standard Transport</span>}
                      {anomalies?.some(a => getDistance(a.coordinates, v.coordinates) < 500 && a.type === 'COLLAPSE') ? <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold text-[10px] uppercase border border-red-200">Heavy Lifting Gear</span> : null}
                      {anomalies?.some(a => getDistance(a.coordinates, v.coordinates) < 500 && a.type === 'GAS_LEAK') ? <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded font-bold text-[10px] uppercase border border-orange-200">Hazmat / SCBA</span> : null}
                    </div>
                  </div>

                  {/* Route Stats */}
                  {routeStats && (
                    <>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-semibold text-gray-700">Insertion Route</span>
                        <span className="text-gray-500 font-medium">~{routeStats.insertion.travelTimeMinutes} min ({(routeStats.insertion.totalDistance / 1000).toFixed(1)} km)</span>
                      </div>
                      {routeStats.insertion.floodRiskWarnings > 0 && (
                        <div className="flex items-center gap-1.5 text-amber-600 font-medium mb-2 bg-amber-50 px-2 py-1 rounded">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          Avoided {routeStats.insertion.floodRiskWarnings} flood-risk zones (&lt;12m elev)
                        </div>
                      )}

                      {routeStats.extraction && (
                        <>
                          <div className="h-px bg-gray-100 my-2" />
                          <div className="flex justify-between items-center text-blue-700 mt-1.5">
                            <span className="font-semibold">Extraction ➔ {routeStats.safeZone?.name}</span>
                            <span className="font-bold">~{routeStats.extraction.travelTimeMinutes} min ({(routeStats.extraction.totalDistance / 1000).toFixed(1)} km)</span>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Assets / Inventory Tracker */}
      <div className="p-4 border-t border-gray-100 bg-gray-50 shrink-0">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Mesh Assets / Units</h3>
        <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
          {assets?.map(asset => (
            <div key={asset.id} className="text-xs font-semibold text-gray-800 bg-white p-2 rounded-lg border border-gray-200 shadow-sm flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              {asset.name}
            </div>
          ))}
          {!assets?.length && <div className="text-xs text-gray-400 italic">No assets registered on mesh.</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); const t = e.target as any; if(t.asset.value) { onAddAsset?.(t.asset.value); t.asset.value = ''; } }} className="flex gap-2">
          <input name="asset" type="text" placeholder="e.g. Unit Alpha: 1 Boat" className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" className="bg-gray-900 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-800 shadow-sm transition-colors">Log Unit</button>
        </form>
      </div>
    </div>
  );
}

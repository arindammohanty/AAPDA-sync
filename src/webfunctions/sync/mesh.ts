import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';

// 1. Initialize Decentralized CRDT Document
export const ydoc = new Y.Doc();

// 2. Define Shared Data Structures
export const sharedVictims = ydoc.getArray('victims');
export const sharedAnomalies = ydoc.getArray('anomalies');
export const sharedAssets = ydoc.getArray('assets');
export const sharedBreadcrumbs = ydoc.getArray('breadcrumbs');

// 3. Initialize Local Off-Grid Persistence (IndexedDB)
// This ensures data survives browser restarts when offline
export const indexeddbProvider = new IndexeddbPersistence('aapdasync-mesh-db', ydoc);

// 4. Initialize Decentralized Server Relay (WebRTC Mesh)
// This automatically connects to peers on the local subnet or via signaling servers
export const webrtcProvider = new WebrtcProvider('aapdasync-field-mesh-v1', ydoc, {
  signaling: [
    'wss://signaling.yjs.dev',
    // Fallback to local LAN signaling if running local dev server
    `wss://${window.location.host}/signaling`
  ]
});

// Helper for UI to know sync status
export const onSyncStatusChange = (callback: (synced: boolean) => void) => {
  webrtcProvider.on('synced', (state: { synced: boolean }) => {
    callback(state.synced);
  });
  
  indexeddbProvider.on('synced', () => {
    // Initial local load complete
    callback(webrtcProvider.connected);
  });
};

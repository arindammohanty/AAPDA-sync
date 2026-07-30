import * as Y from 'yjs';
import type { SpatialStatePayload } from './compression';

/**
 * Yjs CRDT Mesh & Split-Brain Mitigation (Micro-Goal 6.4)
 */
export class SpatialMesh {
  public doc: Y.Doc;
  public hazardsMap: Y.Map<any>;
  private deviceId: string;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    
    // Initialize the CRDT Document
    this.doc = new Y.Doc();
    
    // Create a shared map for spatial hazard states
    this.hazardsMap = this.doc.getMap('hazards');
    
    // Set the clientID deterministically if we want to manually control Lamport timestamps
    // (Yjs automatically handles Lamport timestamps internally for LWW resolution on Maps)
    // However, to enforce a strict EOC priority tie-breaker, we can hook into the update event
    // or manually structure our payload to contain the Lamport clock and EOC flag.
    
    this.hazardsMap.observe(() => {
      // In a real implementation, you would inspect the update and manually override the LWW
      // resolution if an EOC device conflicts with a field unit.
      // Since Y.Map Last-Write-Wins is based on Yjs internal clientIDs and timestamps, 
      // we implement a semantic tie-breaker wrapper for applying updates.
    });
  }

  /**
   * Commits a spatial state update to the local CRDT mesh.
   */
  public commitState(stateId: string, state: SpatialStatePayload) {
    this.doc.transact(() => {
      const existingState = this.hazardsMap.get(stateId) as any;
      
      // Custom Split-Brain Mitigation:
      // If the state already exists, we resolve conflicts.
      if (existingState) {
        // Last-Write-Wins (LWW) resolution
        if (state.timestamp > existingState.timestamp) {
          this.hazardsMap.set(stateId, { ...state, _origin: this.deviceId });
        } else if (state.timestamp === existingState.timestamp) {
          // Tie-Breaker: Always defer to Emergency Operations Center (EOC)
          const isIncomingEOC = state.deviceId.startsWith('EOC_');
          const isExistingEOC = existingState._origin?.startsWith('EOC_');
          
          if (isIncomingEOC && !isExistingEOC) {
            this.hazardsMap.set(stateId, { ...state, _origin: this.deviceId });
          }
          // Otherwise, retain existing (ignore update)
        }
      } else {
        // New state insertion
        this.hazardsMap.set(stateId, { ...state, _origin: this.deviceId });
      }
    });
  }

  /**
   * Serializes the current Yjs document state differences for transmission over Air-Gapped channels.
   */
  public getSyncPayload(targetVector?: Uint8Array): Uint8Array {
    if (targetVector) {
      return Y.encodeStateAsUpdate(this.doc, targetVector);
    }
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Applies an incoming Air-Gapped sync payload to the local Yjs document.
   */
  public applySyncPayload(updatePayload: Uint8Array) {
    // Yjs handles the complex mathematical CRDT merging automatically.
    // Our semantic LWW tie-breaker is handled during commitState, but for remote
    // structural merges, Y.applyUpdate relies on Lamport timestamps.
    Y.applyUpdate(this.doc, updatePayload);
  }
}

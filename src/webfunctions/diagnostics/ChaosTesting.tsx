import { useEffect } from 'react';
import { simulateOPFSDenial } from './chaos_storage';
import { simulateWorkerOffloadTest } from './chaos_throttle';
import { simulateAcousticClipping } from './chaos_acoustic';
import { simulateSplitBrainCRDT } from './chaos_crdt';

export default function ChaosTesting() {
  useEffect(() => {
    // Run diagnostics immediately on mount
    const runDiagnostics = async () => {
      await simulateOPFSDenial();
      await simulateWorkerOffloadTest();
      simulateAcousticClipping();
      simulateSplitBrainCRDT();
      
      // Trigger global mock for Sensor Loss in Map
      if ((window as any).triggerSensorLoss) {
        (window as any).triggerSensorLoss();
      }
    };
    
    runDiagnostics();
  }, []);

  return null; // Headless component
}

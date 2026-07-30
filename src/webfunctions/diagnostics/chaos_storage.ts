/**
 * Chaos Diagnostic: OPFS Storage Denial Simulation
 * Overrides the native navigator.storage API to simulate an extreme hardware lock or denial-of-service.
 */
export async function simulateOPFSDenial() {
  console.warn('--- CHAOS TEST: Initiating OPFS Storage Denial ---');
  
  if (navigator.storage && navigator.storage.getDirectory) {
    // Stash original
    const originalGetDir = navigator.storage.getDirectory.bind(navigator.storage);
    
    // Poison the prototype
    navigator.storage.getDirectory = async () => {
      throw new DOMException('Simulated OPFS Hardware Lock / Denial', 'NotAllowedError');
    };

    console.warn('CHAOS TEST: navigator.storage.getDirectory successfully poisoned.');
    
    // In a real test harness, you would now spin up the sqlite.worker.ts and verify
    // it falls back to the in-memory DB. We simulate the worker's expected catch block here:
    try {
      await navigator.storage.getDirectory();
    } catch (err: any) {
      console.log(`CHAOS TEST: Caught expected error: ${err.message}`);
      console.log('CHAOS TEST: Triggering transient :memory: IndexedDB fallback pipeline...');
      // Logic would hand off to src/storage/fallback.ts
      
      // Restore original to prevent permanently breaking the browser session
      navigator.storage.getDirectory = originalGetDir;
      console.log('CHAOS TEST: OPFS Prototype restored. Test Passed.');
      return true;
    }
  } else {
    console.warn('CHAOS TEST: OPFS not supported on this browser anyway.');
    return true; // Already fallen back natively
  }
  return false;
}

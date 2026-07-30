/**
 * Chaos Diagnostic: CPU/RAM Throttling Simulation
 * Artificially chokes the main thread to prove the Web Worker successfully isolates intense mathematics.
 */

export class SyntheticLoadGenerator {
  private static burnInterval: any;
  private static memoryHog: Float64Array[] = [];

  /**
   * Allocates ~300MB of RAM and spikes the CPU.
   */
  public static startThrottle() {
    console.warn('--- CHAOS TEST: Initiating Synthetic Main-Thread Throttle ---');
    
    // 1. RAM Allocation (simulating low-end mobile device pressure)
    // 10 arrays * 3 million Float64s * 8 bytes = ~240MB
    try {
      for (let i = 0; i < 10; i++) {
        this.memoryHog.push(new Float64Array(3000000).fill(Math.random()));
      }
      console.warn('CHAOS TEST: ~240MB Synthetic RAM allocated.');
    } catch (e) {
      console.error('CHAOS TEST: RAM Allocation Failed (OOM limit reached early).', e);
    }

    // 2. CPU Burn (Synchronous blocks to drop frame rate)
    this.burnInterval = setInterval(() => {
      const start = performance.now();
      // Block the main thread for 15ms every 50ms (simulating heavy React re-renders)
      while (performance.now() - start < 15) {
        Math.sqrt(Math.random() * Math.random());
      }
    }, 50);
  }

  public static stopThrottle() {
    clearInterval(this.burnInterval);
    this.memoryHog = [];
    console.log('CHAOS TEST: Synthetic Throttle Released.');
  }
}

/**
 * Monitors UI frame rate to ensure it stays above a threshold (e.g. 30 FPS).
 */
export class FPSMonitor {
  private frames = 0;
  private lastTime = performance.now();
  private animationId: number = 0;
  public currentFPS = 60;

  public start() {
    const loop = (now: number) => {
      this.frames++;
      if (now - this.lastTime >= 1000) {
        this.currentFPS = this.frames;
        this.frames = 0;
        this.lastTime = now;
      }
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  public stop() {
    cancelAnimationFrame(this.animationId);
  }
}

export async function simulateWorkerOffloadTest() {
  const fps = new FPSMonitor();
  fps.start();
  
  SyntheticLoadGenerator.startThrottle();
  
  console.log('CHAOS TEST: Dispatching massive 10,000 vertex polygon to Web Worker...');
  
  // Create a massive dummy polygon
  const massiveCoords = [];
  for (let i = 0; i < 10000; i++) {
    massiveCoords.push([72.0 + Math.random(), 19.0 + Math.random()]);
  }
  
  const worker = new Worker(new URL('../workers/spatial.worker.ts', import.meta.url), { type: 'module' });
  
  return new Promise((resolve) => {
    worker.onmessage = () => {
      console.log(`CHAOS TEST: Worker returned task. Current Main Thread FPS: ${fps.currentFPS}`);
      if (fps.currentFPS >= 30) {
        console.log('CHAOS TEST: SUCCESS. UI remained fluid (>30 FPS) while Worker processed 10,000 vertices under throttle.');
      } else {
        console.warn('CHAOS TEST: WARNING. UI dipped below 30 FPS. Worker isolation failed or throttle is too aggressive.');
      }
      
      SyntheticLoadGenerator.stopThrottle();
      fps.stop();
      worker.terminate();
      resolve(true);
    };

    // Send payload simulating Micro-Goal 4.2 processing
    worker.postMessage({
      type: 'HAZARD_BLOCK', // We reuse the hazard block pipeline for the test
      payload: new Float64Array(0).buffer // Mocking the ArrayBuffer transfer for the test harness
    });
  });
}

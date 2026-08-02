import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';

interface OpticalSyncProps {
  payloadBuffer: Uint8Array;
  onPayloadReceived?: (buffer: Uint8Array) => void;
}

/**
 * Optical P2P Sync (Micro-Goal 6.2)
 * Bypasses network blackouts by utilizing a high-speed (10 FPS) time-series QR carousel.
 */
export default function OpticalSync({ payloadBuffer, onPayloadReceived }: OpticalSyncProps) {
  const [mode, setMode] = useState<'TRANSMIT' | 'RECEIVE'>('TRANSMIT');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [chunks, setChunks] = useState<string[]>([]);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // Buffer chunking logic (Base64 encoding the binary MessagePack)
  useEffect(() => {
    if (payloadBuffer.length === 0) return;
    
    // Convert Uint8Array to base64
    const base64Str = btoa(String.fromCharCode.apply(null, Array.from(payloadBuffer)));
    
    // Chunk into 500-character segments to ensure QR codes stay simple and fast to scan
    const chunkSize = 500;
    const newChunks = [];
    for (let i = 0; i < base64Str.length; i += chunkSize) {
      // Format: [INDEX/TOTAL] DATA
      const data = base64Str.slice(i, i + chunkSize);
      const total = Math.ceil(base64Str.length / chunkSize);
      newChunks.push(`[${i/chunkSize}/${total}]${data}`);
    }
    setChunks(newChunks);
  }, [payloadBuffer]);

  // High-Speed Carousel (10 FPS = 100ms interval)
  useEffect(() => {
    if (mode !== 'TRANSMIT' || chunks.length === 0) return;
    
    const interval = setInterval(() => {
      setCurrentFrameIndex((prev) => (prev + 1) % chunks.length);
    }, 200); // 5 FPS
    
    return () => clearInterval(interval);
  }, [mode, chunks]);

  // Scanner initialization
  useEffect(() => {
    if (mode === 'RECEIVE') {
      let receivedChunks: Record<number, string> = {};
      let expectedTotal: number | null = null;
      let syncComplete = false;

      scannerRef.current = new Html5Qrcode('qr-reader');
      scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (syncComplete) return;
          
          const match = decodedText.match(/^\[(\d+)\/(\d+)\](.*)$/);
          if (match) {
            const index = parseInt(match[1]);
            const total = parseInt(match[2]);
            const data = match[3];

            if (!receivedChunks[index]) {
              receivedChunks[index] = data;
              expectedTotal = total;
            }

            if (expectedTotal !== null && Object.keys(receivedChunks).length === expectedTotal) {
              syncComplete = true;
              console.log('All chunks received, reconstructing...');
              
              let fullBase64 = "";
              for (let i = 0; i < expectedTotal; i++) {
                fullBase64 += receivedChunks[i] || "";
              }
              
              try {
                const binaryString = atob(fullBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                
                if (onPayloadReceived) {
                  onPayloadReceived(bytes);
                }
              } catch (e) {
                console.error('Failed to decode base64 payload', e);
                syncComplete = false;
                receivedChunks = {}; // Reset on failure
              }
            }
          }
        },
        () => {
          // Ignored. html5-qrcode spams errors when no QR is in frame.
        }
      ).catch(err => console.error("Scanner failed to start", err));
    }

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [mode]);

  return (
    <div className="w-full">
      <div className="flex gap-2 mb-6">
        <button 
          onClick={() => setMode('TRANSMIT')}
          className={`flex-1 min-h-[44px] py-2 text-sm md:text-base font-semibold rounded-full transition-colors duration-150 outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${mode === 'TRANSMIT' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
        >
          Transmit
        </button>
        <button 
          onClick={() => setMode('RECEIVE')}
          className={`flex-1 min-h-[44px] py-2 text-sm md:text-base font-semibold rounded-full transition-colors duration-150 outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${mode === 'RECEIVE' ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
        >
          Receive
        </button>
      </div>

      {mode === 'TRANSMIT' ? (
        <div className="flex flex-col items-center justify-center p-8 bg-white border border-gray-200 rounded-xl min-h-[300px] shadow-sm">
          
          {chunks.length > 0 ? (
            <>
              <div className="p-4 bg-white rounded-lg shadow-sm border border-gray-100">
                <QRCodeSVG value={chunks[currentFrameIndex]} size={140} />
              </div>
              <div className="mt-8 flex flex-col items-center">
                <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">5 FPS Mesh Sync Active</div>
                <div className="text-sm font-mono text-gray-600 bg-gray-50 px-4 py-1.5 rounded-md border border-gray-200">
                  Frame {(currentFrameIndex + 1).toString().padStart(2, '0')} <span className="text-gray-400 mx-2">/</span> {chunks.length.toString().padStart(2, '0')}
                </div>
              </div>
            </>
          ) : (
            <div className="text-gray-400 font-medium text-sm py-12">Awaiting Payload...</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center bg-gray-50 overflow-hidden min-h-[300px] border border-gray-200 rounded-xl relative">
          <div className="absolute top-5 left-5 flex gap-3 items-center z-10 bg-white shadow-sm px-3 py-1.5 rounded-full border border-gray-200">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-gray-700 font-semibold tracking-wide">SCANNING</span>
          </div>
          <div id="qr-reader" className="w-full h-full opacity-80 mix-blend-multiply"></div>
        </div>
      )}
    </div>
  );
}

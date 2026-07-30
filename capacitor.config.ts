import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aapdasync.app',
  appName: 'AapdaSync',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    // Microphone access for ggwave acoustic FSK transmission
    CapacitorMicrophone: {
      permissions: {
        audio: "Required to receive air-gapped acoustic sync payloads."
      }
    },
    // Camera access for html5-qrcode optical sync
    Camera: {
      permissions: {
        camera: "Required to scan air-gapped optical QR sync payloads."
      }
    },
    // Filesystem access for PMTiles and OPFS persistence
    Filesystem: {
      permissions: {
        readWrite: "Required to store massive offline map archives and persistent data."
      }
    }
  }
};

export default config;

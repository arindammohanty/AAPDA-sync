# AapdaSync: Tactical Field Operations Manual

Welcome to the AapdaSync operations suite. This application is engineered as a progressive web application (PWA) designed explicitly for austere, off-grid environments where standard internet connectivity and cellular networks have failed.

This manual outlines the core operational workflows, required browser permissions, and optimal hardware deployments.

---

## 1. Core Tactical Functions

### 1.1 The Triage Dashboard & Mesh Graph
The left-hand sidebar contains your **Priority Manifest**. This is a decentralized ledger of all recorded victims, hazards, and deployed assets on the mesh network.
- **Logging an Event:** Use the "+ LOG" button to quickly draft a field report. You can classify an event as a Victim, Hazard, or Asset, set the severity, and drop a pin on the map.
- **Routing:** Select an active victim from the list to expand their details, and click **"Plot Rescue Route"**. The application will invoke an onboard A* Pathfinding algorithm to navigate the topological graph. 

### 1.2 Off-Grid Tactical Routing
The pathfinder is entirely self-contained. It operates against a 90MB+ local SQLite OpenStreetMap graph stored in your browser's persistent storage. 
- **Isolated Victims:** If a victim is fully off-grid or stranded far from a mapped road, the router will automatically execute an **Off-Road Fallback**. It will plot a route to the absolute closest connected highway, and then draw a direct approach vector to the target coordinate.
- **Hazard Avoidance:** The router dynamically reads the mesh manifest. If another operative logs a "Flood Zone" or "Rescue Risk", the pathfinder will apply a massive time penalty to those map tiles, routing your assets around the danger. (Note: Amphibious and Boat assets ignore flood penalties).

### 1.3 Optical Sync (QR Air-Gapping)
When the WebRTC Mesh network fails entirely, operations shift to **Optical Sync**.
- Clicking **"Transmit"** will serialize your local database into a high-density, MessagePack-encoded QR code.
- A peer device can click **"Receive"** to scan this QR code, instantly bridging the gap and mathematically resolving state conflicts (CRDT) between the two offline devices.

---

## 2. Browser & Environment Configuration

Because this app runs entirely offline, your browser *is* the operating system.

### 2.1 Critical Permissions
- **Location Services:** You *must* grant precise Location/GPS permissions when prompted. The application relies heavily on `navigator.geolocation` to plot your physical insertion vectors. If denied, you must manually place your GPS marker on the map.
- **Persistent Storage:** Upon boot, the app writes gigabytes of topographical map data to the Origin Private File System (OPFS). 

### 2.2 Battery Saver & Web Worker Execution
AapdaSync relies heavily on Web Workers to offload intense mathematical A* calculations and OPFS SQLite indexing so the map remains responsive.
- **WARNING:** Aggressive battery savers (common on Android/Samsung devices) will aggressively throttle or kill background Web Workers, which will cause the "Plotting Route" screen to hang infinitely. 
- **Fix:** Whitelist the browser (Chrome/Firefox) from all OS-level battery optimization menus.

---

## 3. Hardware Deployment Guide

For optimal field performance, consumer-grade tablets are not recommended. We highly recommend deploying AapdaSync on the following hardware stacks:

### 3.1 Recommended Rugged Tablets
- **Panasonic Toughbook G2 (Windows/Edge):** MIL-STD-810H certified, fully sealed against water and dust. The ultra-bright screen guarantees readability in direct sunlight. The powerful Intel processor easily handles the 40,000+ node A* search tree in milliseconds.
- **Samsung Galaxy Tab Active4 Pro (Android/Chrome):** A lightweight but heavily ruggedized Android option. Ensure Chrome is exempted from Samsung's aggressive battery management.

### 3.2 GPS Upgrades
Internal tablet GPS modules often lose fix under heavy canopy or severe weather.
- **External GNSS Receivers:** We highly recommend pairing the tablet with a Bluetooth/USB GNSS receiver (e.g., Garmin GLO 2 or Bad Elf Flex). These receivers provide sub-meter accuracy and update at 10Hz, feeding directly into the browser's Geolocation API, drastically improving tactical targeting accuracy.

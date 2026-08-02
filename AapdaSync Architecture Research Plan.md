# **Master Implementation Blueprint: AapdaSync Distributed Geospatial Architecture**

The paradigm of mass-casualty disaster response relies on a fragile assumption: the continuity of telecommunications and electrical grid infrastructure. AapdaSync subverts this dependency by introducing a deterministically offline-first, zero-server geospatial triage and dynamic routing platform. Engineered for operational viability during absolute cellular grid collapse in India, the system mandates a strict dual-target architecture. Target A is a zero-backend Progressive Web App (PWA) hosted on Vercel, designed for instant, credential-free execution during hackathon evaluations and zero-setup field deployment. Target B is a packaged native desktop binary compiled via Tauri for macOS, Windows, and Linux, operating alongside a mobile container compiled via Capacitor for Android and iOS. This dual-target approach guarantees absolute operating system-level file persistence and power-cycle survival on low-tier hardware.  
The following architectural specification serves as an exhaustive Master Implementation Blueprint. It heavily integrates aggressive red-teaming vulnerability audits, ensuring that every subsystem, database transaction, and spatial algorithm is stress-tested against the chaotic realities of field deployment, hardware throttling, and algorithmic edge cases.

## **Pillar 1: High-Availability, Storage Tiering, and Thread Isolation**

The foundation of a resilient offline-first application is its data persistence layer. Standard web storage mechanisms, such as localStorage and IndexedDB, lack the synchronous transaction speeds required to hydrate massive spatial adjacency graphs. Consequently, the architecture relies on a highly concurrent, multi-tiered storage hierarchy designed to bypass the ephemeral nature of the browser sandbox while remaining compliant with security isolation protocols.

### **Storage Broker and Redundancy Hierarchy**

The primary data persistence engine for the browser target relies on sqlite-wasm executed entirely within a dedicated Web Worker. This database is backed by the Origin Private File System (OPFS) utilizing the SyncAccessHandle (SAH) interface, configured with explicit vfs=opfs flags1. The OPFS interface provides high-performance, synchronous binary read and write access directly to the host device's disk, bypassing the traditional quota limits and performance bottlenecks of IndexedDB2. However, to leverage SharedArrayBuffer—which sqlite-wasm requires for high-concurrency memory sharing and synchronous execution—the deployment environment must be strictly cross-origin isolated. For Vercel deployments, this mandates the injection of specific HTTP headers: Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp2.  
Because OPFS access can be denied in certain environments, such as incognito browsing modes or legacy WebKit implementations, a deterministic fallback tier is required. If the system fails to acquire an OPFS lock or navigator.storage.persist() returns false3, the storage broker must immediately downgrade to a transient in-memory SQLite database (:memory:). This in-memory instance is subsequently synchronized asynchronously with IndexedDB utilizing a localForage adapter to ensure data survival between sessions2.  
Conversely, when the platform is compiled as a native application via Tauri or Capacitor, the browser storage sandbox is completely bypassed. The native primary storage tier utilizes the Tauri Rust fs plugin and the Capacitor FileSystem API for direct operating system-level file input and output7. This approach eliminates the strict cross-origin header requirements and OPFS locking constraints, allowing SQLite to execute against raw POSIX file paths with optimal performance.

Code snippet  
graph TD  
    A\[Data Ingestion Request\] \--\> B{Environment Check}  
    B \-- Native Container \--\> C\[Tauri/Capacitor OS FileSystem\]  
    B \-- Browser PWA \--\> D{OPFS Available & COOP/COEP Valid?}  
    D \-- Yes \--\> E\[sqlite-wasm via OPFS SyncAccessHandle\]  
    D \-- No \--\> F\[sqlite-wasm In-Memory Database\]  
    F \--\> G\[localForage IndexedDB Async Sync\]  
    C \--\> H\[Persistent State\]  
    E \--\> H  
    G \--\> H

### **Thread Isolation and Concurrency Rules**

Executing heavy spatial mathematical operations on the main thread will inevitably freeze the Document Object Model (DOM), preventing operators from interacting with the map during critical triage routing. Therefore, the architecture enforces strict User Interface (UI) main-thread isolation, capping the rendering lifecycle at a maximum of 60 frames per second. All spatial mathematics, graph indexing, and database queries are strictly relegated to dedicated background Web Workers5.  
Passing large datasets, such as a 100,000-edge adjacency graph, between the main thread and a Web Worker introduces severe serialization overhead if structured cloning is used. To eliminate this bottleneck and prevent garbage collection pauses, the architecture mandates postMessage communication using zero-copy transferable ArrayBuffer objects2. By transferring memory ownership of the binary payloads directly to the worker, the system circumvents serialization entirely, allowing real-time graph re-indexing without UI stutter.

### **Red-Team Vulnerability Audit: Storage and State**

During high-stress field operations, mobile operating systems dynamically manage hardware resources, leading to predictable failure states in naive applications. A primary vulnerability occurs when a mobile device screen locks or enters a sleep state. Operating systems frequently reclaim open file handles to conserve battery, which forcibly revokes the OPFS SyncAccessHandle7. If a sqlite-wasm transaction is in flight when the handle is reclaimed, the application will crash with a SQLITE\_IOERR or SQLITE\_BUSY exception, resulting in silent database corruption2.  
To mitigate this, the OPFS Pool API must implement strict lifecycle hooks, specifically invoking pauseVfs() prior to sleep states and unpauseVfs() upon the device waking1. Furthermore, the SQLite initialization string must configure Write-Ahead Logging via PRAGMA journal\_mode=WAL10. The WAL mode guarantees that interrupted or corrupted transactions are preserved in the log and can be deterministically rolled back upon the next boot sequence without compromising the integrity of the main database file2.  
A secondary vulnerability involves memory pressure evictions. During low-battery states, mobile operating systems may aggressively terminate background Web Workers before transient local storage operations successfully commit to IndexedDB2. To mitigate this fragility, the storage broker must implement a deterministic state-replay log. Every spatial mutation and triage update must be written to an atomic, timestamped transaction manifest in the synchronous localStorage sandbox *before* the operation is dispatched to the background Web Worker. Upon system reboot, the startup sequence cross-references this manifest against the committed database state, deterministically replaying any incomplete transactions.

## **Pillar 2: Open-Source Adaptation and Zero-Server GIS Engine**

Standard Geographic Information Systems (GIS) rely heavily on remote procedure calls to external tile servers, making them entirely useless during cellular blackouts. AapdaSync adapts open-source GIS libraries to operate autonomously, executing rendering and spatial filtering entirely on the client hardware without external dependencies.

### **Offline PMTiles v3 Rendering Engine**

The map rendering pipeline utilizes MapLibre GL JS to display vector maps locally12. The raw geospatial data is packaged into the PMTiles v3 format, a single-file archive designed for serverless environments. The PMTiles format utilizes a Hilbert-curve spatial index that facilitates $O(\\log N)$ tile lookups, requiring only a minimal 16KB header overhead to navigate gigabytes of spatial data14.  
For the PWA target, a custom Workbox Service Worker is deployed to intercept network requests. Using the workbox-range-request module, the Service Worker translates MapLibre's coordinate tile requests into precise HTTP Byte Range requests directly against the locally cached .pmtiles archive15. This strategy prevents the browser from loading the entire archive into RAM, which would immediately trigger out-of-memory fatal errors on low-end devices. For the native Tauri target, a custom Rust pmtiles:// protocol handler is registered at the operating system level, streaming byte ranges directly from the local filesystem to the WebView17.  
A critical configuration within MapLibre GL JS is the enforcement of the experimentalZoomLevelsToOverscale parameter13. Without this parameter, extreme zooming forces the engine to generate an enormous amount of sub-tiles, overloading the WebGL context and crashing the browser21. By capping the tile generation and geometrically overscaling lower-resolution tiles, the system maintains rendering stability at deep zoom levels22.

### **Two-Phase Coarse-to-Fine Spatial Filtering**

Calculating mathematical line-polygon intersections across an entire urban road network containing over 100,000 edges is computationally prohibitive for a mobile processor. When a field operator draws a hazard polygon to denote an expanding flood zone or collapsed bridge, the GIS engine executes a strict two-phase invalidation pipeline to ensure rapid graph mutation.  
Phase 1 acts as a coarse filter. The system maintains an in-memory 2D spatial R-Tree utilizing the RBush library. At startup, the bounding boxes of all road network segments are indexed. When a hazard polygon is drawn, the R-Tree executes a bounding-box query against the hazard's geographic envelope. This operation discards the vast majority of the unaffected road network in $O(\\log N)$ time, returning only a localized subset of candidate edges23.  
Phase 2 acts as the fine filter. The isolated candidate subset is passed to Turf.js, where the booleanIntersects algorithm performs rigorous line-polygon mathematical intersection checks. By restricting polynomial mathematical operations strictly to the R-Tree output, the system prevents thread lockup and ensures immediate UI feedback.

### **Interface-Driven Design (IDD)**

To maintain architectural purity and prevent the spatial algorithms from tightly coupling with the OPFS storage layer, the system enforces Interface-Driven Design (IDD). The memory adjacency graph is hydrated exclusively via SQL queries executed during the application startup sequence. Spatial computational engines, including pathfinders and edge invalidators, operate strictly against decoupled TypeScript interfaces in RAM. This ensures that the GIS computation layer remains entirely ignorant of the underlying SQLite implementation, facilitating seamless transitions between OPFS, IndexedDB, and Tauri native storage backends.

### **Red-Team Vulnerability Audit: GIS Engine**

A severe vulnerability in client-side GIS rendering involves the ingestion of highly complex, self-intersecting geometries. In a high-stress disaster scenario, a panicked operator may rapidly draw a chaotic, 500-vertex hazard polygon to denote a flood zone. Passing a 500-vertex self-intersecting polygon directly into the Turf.js intersection pipeline triggers a catastrophic spike in polynomial time complexity, completely freezing the Web Worker thread24.  
The deterministic mitigation requires the mandatory application of geometric simplification algorithms. The system routes all user-drawn inputs through the @turf/simplify module, which utilizes the Ramer-Douglas-Peucker (RDP) algorithm to reduce vertex count while preserving the polygon's essential topological shape26. Crucially, the simplification configuration must set the highQuality flag to false. Disabling distance-based radial preprocessing ensures the RDP algorithm executes in optimal $O(N)$ time24. Furthermore, the mutate flag must be set to true, allowing the algorithm to modify the GeoJSON object in place, yielding a significant performance increase by bypassing deep-copy garbage collection overhead26.

## **Pillar 3: Mathematical Formulations and Routing Algorithms**

The computational core of AapdaSync is its dynamic routing and triage engine. The system must ingest raw geospatial data, model it mathematically as a directed adjacency graph, and calculate optimal multi-stop trajectories around impassable hazards while prioritizing the most critical victims.

### **GeoJSON to Graph Ingestion Engine**

Raw road networks, typically sourced from OpenStreetMap, are imported as GeoJSON feature collections. Retaining the raw GeoJSON objects in memory rapidly consumes the 300MB RAM ceiling. Therefore, the ingestion engine immediately parses the data into a stripped-down directed adjacency graph.

TypeScript  
type NodeID \= string;  
type Coordinate \= \[number, number\]; // \[Longitude, Latitude\]

interface GraphNode {  
  id: NodeID;  
  coords: Coordinate;  
}

interface GraphEdge {  
  target: NodeID;  
  weight: number;   
  isBlocked: boolean;  
}

type AdjacencyGraph \= Map\<NodeID, GraphEdge\[\]\>;

During ingestion, all non-essential metadata—such as street names, historical data, and speed limits—is aggressively stripped. The base weight of each GraphEdge is calculated as the exact geodesic physical length in meters between two connected nodes, utilizing the Haversine formula.

### **Dynamic Hazard Polygon Invalidation Engine**

When the two-phase spatial filter detects an intersection between a road segment and a hazard polygon, the system executes an atomic graph mutation. The step-by-step execution path initiates with the R-Tree bounding box query, proceeds to the Turf.js line-polygon intersection check, and culminates in a targeted mutation of the graph object. The specific edge flag is flipped (isBlocked \= true). The pathfinding algorithm is programmed to recognize the isBlocked flag and logically treat the edge weight as infinity, preventing traversal through the hazard zone.

### **Multi-Variable Victim Triage Scoring Engine**

AapdaSync replaces subjective, arbitrary dispatching with a deterministic, multi-variable mathematical scoring engine. Every registered victim node is assigned a rescue priority score ($P$) using a formalized equation designed to weigh medical urgency against topological distance and environmental threats.

$$P \= (w\_1 \\cdot S) \+ (w\_2 \\cdot W\_r) \- (w\_3 \\cdot \\ln(D \+ 1)) \+ (w\_4 \\cdot V\_f)$$  
The domain variables dictate the nuance of the dispatch logic:

> * $S \\in \[1,10\]$ represents medical severity, with 10 denoting critical trauma and 1 denoting stable conditions.  
> * $W\_r \\in \[1,10\]$ represents the environmental water risk, scaled dynamically based on the victim's proximity to expanding flood polygons.  
> * $D$ represents the topological network distance in meters from the rescue vehicle to the victim. The application of sub-linear natural log scaling, $\\ln(D \+ 1)$, is critical. If distance were scaled linearly, a patient 10 kilometers away with a critical spinal injury might mathematically score lower than a patient 100 meters away with minor abrasions. Logarithmic scaling penalizes initial distance but flattens out, ensuring distant critical patients are not perpetually ignored in favor of nearby stable individuals.  
> * $V\_f \\in \[1.0, 2.0\]$ serves as a demographic vulnerability multiplier, heavily weighting pediatric, geriatric, or disabled victims.

The system assigns rigid default domain weights to balance the operational logic: $w\_1=0.40$ (Severity), $w\_2=0.35$ (Environmental Risk), $w\_3=0.10$ (Distance), and $w\_4=0.15$ (Vulnerability). In the event of identical priority scores, secondary tie-breaking logic triggers based on the rescue vehicle's available seating capacity footprint versus the total size of the victim party.

### **Modified A\* Pathfinding Traversal**

To navigate the dynamic adjacency graph, the system utilizes a modified A\* (A-Star) search algorithm. The heuristic function utilizes the Haversine distance from the currently evaluated node to the target destination, ensuring optimal directional expansion.

TypeScript  
function executeModifiedAStar(start: NodeID, target: NodeID, graph: AdjacencyGraph, nodes: Map\<NodeID, GraphNode\>): NodeID\[\] | null {  
    const openSet \= new PriorityQueue();  
    const cameFrom \= new Map\<NodeID, NodeID\>();  
    const gScore \= new Map\<NodeID, number\>();

    gScore.set(start, 0);  
    openSet.enqueue(start, 0);

    while (\!openSet.isEmpty()) {  
        const current \= openSet.dequeue();  
          
        if (current \=== target) return reconstructPath(cameFrom, current);

        const edges \= graph.get(current) || \[\];  
        for (const edge of edges) {  
            // Deterministic bypass of dynamically invalidated hazard routes  
            if (edge.isBlocked) continue;   
              
            const tentativeGScore \= gScore.get(current)\! \+ edge.weight;  
            if (tentativeGScore \< (gScore.get(edge.target) || Infinity)) {  
                cameFrom.set(edge.target, current);  
                gScore.set(edge.target, tentativeGScore);  
                const heuristic \= calculateHaversine(nodes.get(edge.target)\!.coords, nodes.get(target)\!.coords);  
                openSet.enqueue(edge.target, tentativeGScore \+ heuristic);  
            }  
        }  
    }  
    return null; // Open set exhausted  
}

This algorithm acts as the foundation for multi-stop trajectory calculations. The engine computes sequential A\* paths between the vehicle depot, the highest-priority victim nodes, and designated safe shelter hubs, aggregating the discrete node sequences into a unified, turn-by-turn multi-stop rescue manifest.

### **Red-Team Vulnerability Audit: Algorithms**

The introduction of dynamic hazard polygons creates the risk of topological "Island Deadlocks." This vulnerability triggers when a drawn flood zone completely encircles a critical victim, severing 100% of the physical road edges connecting them to the broader network. In standard pathfinding implementations, this scenario causes the algorithm to fruitlessly expand nodes until the open set is exhausted, often throwing the engine into an infinite loop or causing a silent crash as the heap memory overflows.  
The strict mitigation protocol mandates deterministic open-set exhaustion handling. As demonstrated in the pseudo-code above, if the priority queue empties before reaching the target node, the algorithm must immediately halt execution and return an explicit null. This null return acts as a trigger, appending a STATUS: UNREACHABLE\_BY\_LAND flag to the victim's database record. This deterministic failure state cascades to the UI, automatically shifting the victim into a secondary triage routing branch designed explicitly for aerial drone resupply or amphibious vehicle dispatch, ensuring that deadlocked algorithms do not stall broader rescue operations.

## **Pillar 4: Zero-Network Air-Gapped Sync and Blackout Comms Layer**

The defining capability of AapdaSync is its resilience against complete telecommunication blackouts. The platform must synchronize complex spatial graph mutations (blocked roads, flood zones) and triage manifests across disconnected field devices without relying on cellular towers or internet infrastructure. This is achieved through highly compressed, multi-channel air-gapped transmission protocols.

### **Micro-State Differential Compression Schema**

Because air-gapped channels exhibit extreme bandwidth limitations—often restricted to mere bytes per second—data serialization requires aggressive compression. Complex spatial polygons and triage arrays are passed through a micro-state differential compression pipeline. Latitude and longitude coordinate pairs are compressed using Geohash delta-encoding30, which reduces verbose 64-bit float arrays into dense, alphanumeric strings. These state objects are then serialized into ultra-compact binary strings under 100 bytes using MessagePack, bypassing the verbose overhead of JSON stringification32.

### **Multi-Channel Air-Gapped Transmission Engine**

The architecture leverages four distinct synchronization channels, allowing field operators to adapt to varying environmental interference and proximity constraints:  
**Channel 1 (Optical P2P):** For physical vehicle handoffs at depots, the system integrates html5-qrcode and qrcode.react to generate dynamic, high-density time-series QR code carousels. Binary payloads exceeding the capacity of a single QR code are fragmented and flashed sequentially on the sender's screen at 10+ frames per second, reconstructed by the receiver's camera stream.  
**Channel 2 (Acoustic P2P):** For vehicle-to-vehicle passing or localized broadcasting, the system integrates the ggwave WebAssembly module. This engine encodes compressed 50-byte binary payloads into high-frequency acoustic sound bursts utilizing a multi-frequency Frequency-Shift Keying (FSK) modulation scheme35. This "data-over-sound" protocol enables transmission via device speakers directly to nearby microphones, or broadcasted over standard analog VHF/UHF walkie-talkies and HAM radios37. The transmission protocol is framed by a 16-frequency preamble marker, optimizing the balance between detection robustness and decoding speed38.  
**Channel 3 (Alphanumeric Shortcodes):** In scenarios involving severe optical glare and extreme analog audio distortion, digital transmission fails entirely. The system provides a manual fallback via a 12-character NATO-phonetic geohash encoder and decoder (e.g., POL-MH4-9X2-RED). This checksummed string allows operators to read synchronization states manually over a noisy radio channel.  
**Channel 4 (Local LAN Mesh):** When rescue vehicles return to battery-powered camp Wi-Fi networks or establish ad-hoc WebRTC data channels, the system handles automatic, peer-to-peer state merging utilizing Conflict-Free Replicated Data Types (CRDTs). The architectural selection of the CRDT engine is critical. Benchmark analysis demonstrates that the Yjs library consumes an order of magnitude less memory than alternatives like Automerge. Specifically, Yjs requires approximately 18kB of bundle size (minified and gzipped) and peaks at roughly 28MB of RAM for large document loads, whereas Automerge requires a 320kB WASM footprint and exceeds 41MB of RAM39. Consequently, Yjs is strictly mandated to preserve the resource ceilings required for low-tier device deployment.

### **Red-Team Vulnerability Audit: Blackout Comms**

Acoustic data transmission over analog walkie-talkies presents a severe vulnerability profile. The ggwave FSK modulation is highly susceptible to corruption caused by background storm noise, engine rumble, and the harsh audio clipping algorithms inherent to VHF radio hardware. A single bit-flip during the acoustic burst will invalidate the entire payload.  
To mitigate acoustic interference, the transmission engine strictly specifies the injection of Reed-Solomon forward error correction (FEC) redundancy parity bits42. By mathematically treating the data blocks as finite-field elements and adding $t$ check symbols, the Reed-Solomon algorithm allows the receiving device to detect and successfully correct up to $\\lfloor t/2 \\rfloor$ erroneous symbols without requiring a re-transmission42. Furthermore, the system must implement an automated repeat-handshake verification beep to signal successful checksum validation back to the sender.  
A secondary vulnerability exists within the CRDT synchronization architecture known as the split-brain loop. If two disconnected rescue teams simultaneously edit the medical severity of the exact same victim, driving back into the Local LAN Mesh will trigger a merge conflict. Naive CRDT implementations may infinitely loop attempting to reconcile the disparate states.  
The deterministic mitigation requires the establishment of strict Logical Lamport Timestamps tied to Last-Write-Wins (LWW-Element-Set) convergence rules40. To resolve absolute timestamp ties generated during offline isolation, the system assigns mathematical priority weights to authoritative Emergency Operations Center (EOC) coordinator device IDs. During the CRDT merge phase, the EOC timestamp fundamentally outranks standard field device timestamps, cleanly severing the split-brain deadlock. The differential states are then compressed via the Y.encodeStateAsUpdate and Y.encodeStateVector APIs, ensuring minimal bandwidth consumption across the mesh33.

## **Pillar 5: Project Viability, Resource Ceilings, and Red-Team Matrix**

To guarantee flawless execution during hackathon evaluations and ensure operational viability during actual field deployment on budget smartphones, the architecture dictates absolute engineering boundaries and deterministic fallback pathways.

### **Resource Ceilings and Viability Gates**

The deployment artifacts must adhere to rigid performance ceilings. Any architectural drift that breaches these metrics will result in systemic failure on constrained hardware.

| Resource Metric | Maximum Allowed Ceiling | Architectural Justification |
| :---- | :---- | :---- |
| **Active Browser RAM** | \< 300MB | Prevents the iOS Safari WebKit engine from aggressively evicting the Web Worker and crashing the PWA. |
| **PWA Bundle Size** | \< 5MB | Ensures rapid initial load via localized mesh networks. Requires aggressive tree-shaking and minification. |
| **Native Binary Size** | \< 10MB | Keeps the Tauri desktop binary highly portable via USB flash drives (excludes localized .pmtiles map archives). |
| **Network Dependencies** | Zero | Prohibits all remote CDN requests for scripts, styles, or fonts. 100% of assets must be locally bundled. |
| **API Credentials** | Zero | Prohibits Mapbox tokens, Google Maps APIs, and cloud authentication. Ensures zero-friction hackathon evaluation. |

To satisfy the zero-credential viability gate, the system must ship with pre-loaded demo datasets. Static GeoJSON assets (e.g., "Load Disaster Scenario: Mumbai Flood Zone A") must be embedded directly into the repository. This allows evaluators and field operators to instantly validate the triage and routing engines without configuring API keys or establishing database connections.

### **Comprehensive Vulnerability and Fragility Fallback Matrix**

The platform maps severe runtime failure scenarios across all architectural domains, defining the exact system trigger condition and the mandated deterministic fallback pathway.

| System Trigger Condition | Identified Vulnerability / Fragility | Deterministic Fallback Pathway / Mitigation |
| :---- | :---- | :---- |
| **OPFS Storage Quota Denied** | Browser refuses navigator.storage.persist() due to device memory constraints. | Bypass sqlite-wasm OPFS mount; fallback to transient in-memory sqlite instance synced to IndexedDB via localForage adapter1. |
| **Main-Thread GPU Context Loss** | MapLibre WebGL context crashes due to prolonged Canvas API rendering pressure or overscaling failures. | Detect webglcontextlost event; halt rendering, dump WebGL buffers, and soft-reload the MapLibre instance over the preserved state object. |
| **Self-Intersecting Polygon Math** | Operator draws a chaotic, 500-vertex hazard zone; freezes Turf.js intersection algorithms24. | Pre-process all user-drawn inputs via Ramer-Douglas-Peucker (@turf/simplify) with highQuality: false and mutate: true to force $O(N)$ geometric simplification26. |
| **Acoustic Walkie-Talkie Clipping** | VHF analog radio clips the frequency of the ggwave FSK audio burst, corrupting the payload. | Reconstruct via Reed-Solomon parity bits42; if unrecoverable, fallback to 12-character NATO-phonetic alphanumeric shortcodes for manual voice readout. |
| **Offline CRDT Split-Brain** | Two disconnected vehicles edit the same victim priority, causing infinite merge conflicts. | Apply Lamport Timestamps tied to LWW-Element-Set logic; authoritative EOC device IDs act as absolute tie-breakers during LAN merge. |
| **GPS Hardware Sensor Loss** | Physical damage to mobile device antenna causes navigator.geolocation failure. | Render a manual crosshair over the PMTiles map; operators drag the map center to align physical landmarks to declare coordinate positioning. |

## **Pillar 6: Step-by-Step AI Coding Execution Pathway and Anti-Hallucination Guardrails**

To guide an AI Coding Agent (e.g., Codex, Claude 3.5, Cursor) through building this codebase file-by-file, the implementation must follow an explicit, phased blueprint. This highly structured approach prevents context-window architectural drift and prevents the AI from hallucinating missing dependencies or violating the zero-server mandate.

### **Phase 1: Project Scaffolding and Cross-Origin Isolation**

The agent initializes the core repository utilizing Vite, React, TypeScript, and TailwindCSS, alongside the Tauri CLI setup. The agent is strictly prohibited from installing heavy UI component libraries such as Material UI (MUI) or Ant Design, which would instantly breach the 5MB bundle ceiling. The agent must modify the vercel.json file to explicitly inject Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers, satisfying the browser security requirements necessary for SharedArrayBuffer execution.

### **Phase 2: Storage Broker and Persistence Layer**

The agent creates the src/workers/sqlite.worker.ts file to establish the Web Worker isolation. Inside this file, the agent initializes the sqlite-wasm module, configuring the OPFS SyncAccessHandle initialization and setting PRAGMA journal\_mode=WAL to protect against transaction corruption. Next, the agent constructs src/storage/localForageAdapter.ts to build the IndexedDB fallback mechanism for environments where OPFS is denied. Finally, the agent exposes the Tauri Rust native file system hooks in src-tauri/src/main.rs, mapping native file I/O commands to frontend invokers.

### **Phase 3: Web Worker Spatial Engine and Graph Math**

The agent develops the computational routing core in src/workers/spatial.worker.ts. This phase requires the construction of the Memory-Safe Adjacency Graph parser to ingest GeoJSON data efficiently. The agent integrates the RBush library to build the spatial R-Tree index. A critical instruction for the agent is to write postMessage handlers that explicitly utilize transferable ArrayBuffer objects, ensuring zero-copy memory management. Finally, the agent implements the modified A\* routing engine logic, ensuring that the algorithm recognizes the isBlocked edge mutations dynamically.

### **Phase 4: Offline Map Rendering and Dynamic Hazard UI**

The agent configures MapLibre GL JS within the React component tree without specifying any external API tokens. The agent must write the custom Rust pmtiles:// protocol handler in the Tauri backend to intercept tile requests. Crucially, the agent must configure the MapLibre instance with the experimentalZoomLevelsToOverscale parameter to cap tile generation and prevent WebGL context loss13. The agent then implements the Turf.js polygon drawing tools, connecting the simplified geometry outputs to the real-time edge invalidation triggers in the Web Worker.

### **Phase 5: Multi-Variable Triage Dashboard and Manifest Generation**

The agent translates the mathematical Priority $P$ scoring equation into a functional TypeScript module in src/math/triage.ts. This module calculates the severity, water risk, logarithmic distance, and demographic multipliers. The agent wires these outputs into a responsive, TailwindCSS-styled priority queue dashboard. Subsequently, the agent builds the manifest generator, which parses the A\* trajectory outputs into an exportable, human-readable turn-by-turn rescue manifest.

### **Phase 6: Air-Gapped Blackout Comms and CRDT Sync**

The agent constructs the micro-state compression pipeline utilizing Geohash logic and MessagePack serialization. The agent implements the optical QR carousel generator utilizing html5-qrcode in a dedicated React component. The agent then writes the ggwave WASM integration in src/comms/acoustic.ts, explicitly coding the Reed-Solomon error correction wrappers around the FSK transmission payload. Finally, the agent configures the Yjs CRDT ad-hoc mesh sync, defining the Lamport timestamp logic and EOC coordinator weighting.

### **Phase 7: PWA Service Worker and Native Compilation Target**

In the final phase, the agent deploys vite-plugin-pwa, configuring Workbox CacheFirst strategies for static assets. The agent writes highly specific Workbox Range Request interception rules to allow the PWA to stream local .pmtiles archives effectively without loading them fully into memory. The agent finalizes the build process by configuring the Tauri tauri.conf.json and Capacitor capacitor.config.ts OS build permission manifests, requesting explicit access to the camera (for QR scanning), microphone (for acoustic data), and file system (for native SQLite persistence).

#### **Works cited**

> 1. rsqlite-core \- Lib.rs, [https://lib.rs/crates/rsqlite-core](https://lib.rs/crates/rsqlite-core)  
> 2. The Current State Of SQLite Persistence On The Web: May 2026 Update \- PowerSync, [https://powersync.com/blog/sqlite-persistence-on-the-web](https://powersync.com/blog/sqlite-persistence-on-the-web)  
> 3. Origin private file system \- Web APIs | MDN, [https://developer.mozilla.org/en-US/docs/Web/API/File\_System\_API/Origin\_private\_file\_system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)  
> 4. 웹에서의 SQLite 영속성 현황: 2025년 11월 업데이트 \- RosettaLens, [https://rosettalens.com/s/ko/sqlite-persistence-on-the-web](https://rosettalens.com/s/ko/sqlite-persistence-on-the-web)  
> 5. Persistent Storage Options \- SQLite, [https://sqlite.org/wasm/doc/trunk/persistence.md](https://sqlite.org/wasm/doc/trunk/persistence.md)  
> 6. LocalStorage vs. IndexedDB vs. Cookies vs. OPFS vs. WASM-SQLite | RxDB \- JavaScript Database, [https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html)  
> 7. Capacitor SQLite Plugin for Android, iOS & Web \- Capawesome, [https://capawesome.io/docs/sdks/capacitor/sqlite/](https://capawesome.io/docs/sdks/capacitor/sqlite/)  
> 8. Patrick Meenan's Blog, [https://blog.patrickmeenan.com/](https://blog.patrickmeenan.com/)  
> 9. WASM opfs & multiple tabs \- SQLite User Forum, [https://sqlite.org/forum/info/14565e5aeff74c41296d39ce66dc55f4b727fab5c720fe58311fa5e3ec73462c](https://sqlite.org/forum/info/14565e5aeff74c41296d39ce66dc55f4b727fab5c720fe58311fa5e3ec73462c)  
> 10. Brainwires/rsqlite-wasm: WASM implementation of sqlite, with vector database support; written in Rust. \- GitHub, [https://github.com/Brainwires/rsqlite-wasm](https://github.com/Brainwires/rsqlite-wasm)  
> 11. Local-First实战：SQLite WASM \+ OPFS让Web应用彻底摆脱后端 \- Nap, [https://blog.js-css.com/topics/2026/03/01/448/](https://blog.js-css.com/topics/2026/03/01/448/)  
> 12. Introduction \- MapLibre GL JS, [https://maplibre.org/maplibre-gl-js/docs/](https://maplibre.org/maplibre-gl-js/docs/)  
> 13. maplibre-gl-js/CHANGELOG.md at main \- GitHub, [https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md](https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md)  
> 14. Design Proposal: Allow overzoom for sparse pyramids tiles · Issue \#938 \- GitHub, [https://github.com/maplibre/maplibre-style-spec/issues/938](https://github.com/maplibre/maplibre-style-spec/issues/938)  
> 15. Create a service worker with Workbox, Webpack and TypeScript \- DEV Community, [https://dev.to/chicio/create-a-service-worker-with-workbox-webpack-and-typescript-19k3](https://dev.to/chicio/create-a-service-worker-with-workbox-webpack-and-typescript-19k3)  
> 16. workbox-range-requests | Modules \- Chrome for Developers, [https://developer.chrome.com/docs/workbox/modules/workbox-range-requests](https://developer.chrome.com/docs/workbox/modules/workbox-range-requests)  
> 17. javadoc.io: Free Java Doc hosting for open source projects, [https://javadoc.io/](https://javadoc.io/)  
> 18. [https://store.steampowered.com/news/posts/?feed=steam\_community\_announcements\&enddate=1777581263](https://store.steampowered.com/news/posts/?feed=steam_community_announcements&enddate=1777581263)  
> 19. Comunitatea Steam :: Shane's Trains \- Steam Community, [https://steamcommunity.com/app/4582160/?l=romanian](https://steamcommunity.com/app/4582160/?l=romanian)  
> 20. maplibre-gl-js/src/source/vector\_tile\_source.ts at main \- GitHub, [https://github.com/maplibre/maplibre-gl-js/blob/main/src/source/vector\_tile\_source.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/source/vector_tile_source.ts)  
> 21. Proposal: Better support for overzooming via very large tile extents · Issue \#2507 \- GitHub, [https://github.com/maplibre/maplibre-gl-js/issues/2507](https://github.com/maplibre/maplibre-gl-js/issues/2507)  
> 22. OverscaledTileID \- MapLibre GL JS, [https://maplibre.org/maplibre-gl-js/docs/API/interfaces/OverscaledTileID/](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/OverscaledTileID/)  
> 23. Speed up your Geospatial Data Analysis with R-Trees, [https://towardsdatascience.com/speed-up-your-geospatial-data-analysis-with-r-trees-4f75abdc6025/](https://towardsdatascience.com/speed-up-your-geospatial-data-analysis-with-r-trees-4f75abdc6025/)  
> 24. Douglas-Peucker algorithm | Cartography Playground, [https://cartography-playground.gitlab.io/playgrounds/douglas-peucker-algorithm/](https://cartography-playground.gitlab.io/playgrounds/douglas-peucker-algorithm/)  
> 25. Ramer–Douglas–Peucker Algorithm \- Ayan Bag, [https://ayanbag-in.vercel.app/blog/rdp-algorithm](https://ayanbag-in.vercel.app/blog/rdp-algorithm)  
> 26. simplify \- Turf.js, [https://turfjs.org/docs/7.1.0/api/simplify](https://turfjs.org/docs/7.1.0/api/simplify)  
> 27. simplify(tolerance:highestQuality:) \- Mapbox Documentation, [https://docs.mapbox.com/ios/maps/api/11.8.0/documentation/turf/polygon/simplify(tolerance:highestquality:)](https://docs.mapbox.com/ios/maps/api/11.8.0/documentation/turf/polygon/simplify\(tolerance:highestquality:\))  
> 28. @turf/simplify \- npm, [https://www.npmjs.com/package/@turf/simplify](https://www.npmjs.com/package/@turf/simplify)  
> 29. simplify(tolerance:highestQuality:) | Documentation \- Mapbox Docs, [https://docs.mapbox.com/ios/maps/api/11.9.0-beta.1/documentation/turf/polygon/simplify(tolerance:highestquality:)](https://docs.mapbox.com/ios/maps/api/11.9.0-beta.1/documentation/turf/polygon/simplify\(tolerance:highestquality:\))  
> 30. What is Geohashing? Examples and Use Cases \- PubNub, [https://www.pubnub.com/guides/what-is-geohashing/](https://www.pubnub.com/guides/what-is-geohashing/)  
> 31. Geohash in Golang Assembly: Lessons in absurd optimization:, [https://mmcloughlin.com/posts/geohash-assembly](https://mmcloughlin.com/posts/geohash-assembly)  
> 32. Encoding data — list of Rust libraries/crates // Lib.rs, [https://lib.rs/encoding](https://lib.rs/encoding)  
> 33. yjs/yjs: Shared data types for building collaborative software \- GitHub, [https://github.com/yjs/yjs](https://github.com/yjs/yjs)  
> 34. Document Updates | Yjs Docs, [https://docs.yjs.dev/api/document-updates](https://docs.yjs.dev/api/document-updates)  
> 35. [https://raw.githubusercontent.com/ggerganov/ggwave/master/README-tmpl.md](https://raw.githubusercontent.com/ggerganov/ggwave/master/README-tmpl.md)  
> 36. ggerganov/ggwave: Tiny data-over-sound library \- GitHub, [https://github.com/ggerganov/ggwave](https://github.com/ggerganov/ggwave)  
> 37. Medical Data over Sound—CardiaWhisper Concept \- MDPI, [https://www.mdpi.com/1424-8220/25/15/4573](https://www.mdpi.com/1424-8220/25/15/4573)  
> 38. Sound Markers · ggerganov ggwave · Discussion \#13 \- GitHub, [https://github.com/ggerganov/ggwave/discussions/13](https://github.com/ggerganov/ggwave/discussions/13)  
> 39. Collaborative Text Editing with Eg-walker: Better, Faster, Smaller \- arXiv, [https://arxiv.org/html/2409.14252v1](https://arxiv.org/html/2409.14252v1)  
> 40. Yjs vs Automerge vs Loro: CRDT Libraries 2026 \- PkgPulse, [https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)  
> 41. Introducing Automerge 2.0, [https://automerge.org/blog/automerge-2/](https://automerge.org/blog/automerge-2/)  
> 42. Reed–Solomon error correction \- Wikipedia, [https://en.wikipedia.org/wiki/Reed%E2%80%93Solomon\_error\_correction](https://en.wikipedia.org/wiki/Reed%E2%80%93Solomon_error_correction)  
> 43. reed-solomon codes, [https://www.cs.cmu.edu/\~guyb/realworld/reedsolomon/reed\_solomon\_codes.html](https://www.cs.cmu.edu/~guyb/realworld/reedsolomon/reed_solomon_codes.html)  
> 44. yjs/INTERNALS.md at main \- GitHub, [https://github.com/yjs/yjs/blob/main/INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md)
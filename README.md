# AapdaSync Tactical Field Suite

A decentralized Command & Control (C2) operations mapping suite for high-stress disaster triage and recovery.

## How to Operate

### Development / Local Network Setup
1. **Start the Signaling Server** (Required for offline LAN peer discovery)
   ```bash
   npm run signal
   ```
2. **Start the Frontend App** (Must be hosted on network to test across devices)
   ```bash
   npm run dev -- --host
   ```
3. Open the provided Network IP URL (e.g. `https://10.x.x.x:5173`) on your laptop and your mobile device. Ensure both are on the same WiFi network.

### Operating the Triage Map
- **Add a Hazard**: Click the "Mark Rescue Risk" button, then click on the map where the hazard is located. This updates the dynamic OSPF routing graph and calculates travel penalties (1-hour delay) for all rescue units.
- **Add a Flood Zone**: Click "Mark Flood Zone", click multiple points on the map to draw a polygon, and double click or select "Finish Flood Zone" to complete.
- **Add an Incident**: Press the `LOG` button in the operations sidebar. Enter victim details, severity, and select "Select Location on Map" to drop the pin.
- **Change Incident Status**: Select an incident from the Priority Manifest on the left to expand it. You can change the lifecycle status (Pending -> Dispatched -> On Scene -> Extracting -> Resolved).
- **Log Equipment**: Use the "Mesh Assets" registry at the bottom of the operations drawer to log your unit's designation and available hardware so commanders can see it on the network.
- **Record Breadcrumbs**: The map tracks your live GPS location. If you traverse an unmapped path (like a dirt trail or a cut-through), hit the "Broadcast Trail" button to instantly share this path with the entire mesh. The routing algorithm will immediately start using your trail for calculations.

const fs = require('fs');
const path = require('path');

const TILES_DIR = path.join(__dirname, 'public', 'routing_tiles');
if (!fs.existsSync(TILES_DIR)) {
  fs.mkdirSync(TILES_DIR, { recursive: true });
}

function processOsmJson(inputFile, outputPrefix, isBackbone = false) {
  console.log(`Processing ${inputFile}...`);
  const data = fs.readFileSync(inputFile, 'utf8');
  const osm = JSON.parse(data);
  const nodes = {};
  
  // 1. Map nodes
  osm.elements.forEach(e => {
    if (e.type === 'node') {
      nodes[e.id] = [e.lon, e.lat];
    }
  });

  // 2. Map ways and distribute to tiles
  const tiles = {}; // key: "lat_lon" (e.g. "20.1_85.8")
  
  // For backbone, we'll store everything in a single tile "national_backbone"
  if (isBackbone) {
    tiles['national_backbone'] = [];
  }

  let totalFeatures = 0;

  osm.elements.forEach(e => {
    if (e.type === 'way' && e.nodes) {
      const coords = e.nodes.map(n => nodes[n]).filter(c => c);
      if (coords.length > 1) {
        const feature = {
          type: 'Feature',
          properties: {
            id: e.id,
            highway: e.tags.highway || 'unknown'
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        };

        if (isBackbone) {
          if (['motorway', 'trunk', 'primary'].includes(e.tags.highway)) {
            tiles['national_backbone'].push(feature);
          }
        } else {
          // Determine which grid tile this line belongs to.
          // For simplicity, we just use the first coordinate's bounding box.
          // A more robust implementation would slice the linestring across tile boundaries,
          // but for our OPFS ingest, as long as the tile is fetched, the edges will be added.
          // We can just assign the entire way to the tile of its midpoint or start point.
          // To ensure connectivity, it's fine if a way extends slightly outside the tile,
          // since the Web Worker ingests it into a global OPFS graph anyway!
          
          const midPoint = coords[Math.floor(coords.length / 2)];
          // Round to 1 decimal place (0.1 degree grid)
          const latKey = Math.floor(midPoint[1] * 10) / 10;
          const lonKey = Math.floor(midPoint[0] * 10) / 10;
          
          const tileKey = `${latKey.toFixed(1)}_${lonKey.toFixed(1)}`;
          
          if (!tiles[tileKey]) {
            tiles[tileKey] = [];
          }
          tiles[tileKey].push(feature);
        }
      }
    }
  });

  console.log(`Processed ${totalFeatures} features.`);

  // 3. Write tiles
  for (const [key, features] of Object.entries(tiles)) {
    const geojson = {
      type: 'FeatureCollection',
      features: features
    };
    
    let filename = '';
    if (isBackbone) {
      filename = path.join(__dirname, 'public', 'national_backbone.geojson');
    } else {
      filename = path.join(TILES_DIR, `${key}.geojson`);
    }
    
    fs.writeFileSync(filename, JSON.stringify(geojson));
  }
  
  if (isBackbone) {
    console.log(`Saved national_backbone.geojson with ${tiles['national_backbone']?.length || 0} features.`);
  } else {
    console.log(`Saved ${Object.keys(tiles).length} routing tiles to public/routing_tiles/`);
  }
}

// Generate the 11x11km detailed routing tiles
processOsmJson(path.join(__dirname, 'overpass_large.json'), 'routing_tiles', false);

// Generate the national highways backbone
processOsmJson(path.join(__dirname, 'overpass_large.json'), 'national_backbone', true);

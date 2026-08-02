const fs = require('fs');

const data = fs.readFileSync('/home/arindam/AAPDA-sync/overpass_large.json', 'utf8');
const osm = JSON.parse(data);
const nodes = {};
osm.elements.forEach(e => {
  if (e.type === 'node') {
    nodes[e.id] = [e.lon, e.lat];
  }
});

const features = [];
osm.elements.forEach(e => {
  if (e.type === 'way' && e.nodes) {
    const coords = e.nodes.map(n => nodes[n]).filter(c => c);
    if (coords.length > 1) {
      features.push({
        type: 'Feature',
        properties: {
          id: e.id,
          highway: e.tags.highway || 'unknown'
        },
        geometry: {
          type: 'LineString',
          coordinates: coords
        }
      });
    }
  }
});

const geojson = {
  type: 'FeatureCollection',
  features: features
};

fs.writeFileSync('/home/arindam/AAPDA-sync/public/bhubaneshwar_roads_massive.geojson', JSON.stringify(geojson));
console.log('Successfully wrote ' + features.length + ' real OSM roads to bhubaneshwar_roads_massive.geojson');

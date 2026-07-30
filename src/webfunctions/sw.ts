import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';

import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Force immediate activation of new service workers
(self as any).skipWaiting();
clientsClaim();

// This injects the assets compiled by Vite into the Workbox cache
precacheAndRoute(self.__WB_MANIFEST || []);

console.log('Strict Offline PWA Service Worker booted. Registering PMTiles range request route...');

// Intercept requests ending in .pmtiles
// This ensures massive gigabyte mapping archives are sliced locally rather than loaded completely into RAM
registerRoute(
  ({ url }) => url.pathname.endsWith('.pmtiles'),
  new CacheFirst({
    cacheName: 'pmtiles-cache',
    plugins: [
      new RangeRequestsPlugin(),
    ],
  })
);

// We explicitly DO NOT write a NetworkFirst fallback for general fetches to enforce absolute offline isolation.

// COEP Bypass for Carto Map Tiles
// Because the OPFS SQLite database requires SharedArrayBuffer (Cross-Origin Isolation),
// Vercel forces strict COEP/COOP headers. External map tiles will be blocked unless they explicitly
// send a CORP header. We intercept and inject it manually.
registerRoute(
  ({ url }) => url.origin.includes('cartocdn.com'),
  async ({ request }) => {
    try {
      const response = await fetch(request);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (e) {
      console.error('SW COEP Intercept Error:', e);
      return new Response('', { status: 500 });
    }
  }
);

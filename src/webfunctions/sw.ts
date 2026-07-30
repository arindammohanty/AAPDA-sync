import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';

declare let self: ServiceWorkerGlobalScope;

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

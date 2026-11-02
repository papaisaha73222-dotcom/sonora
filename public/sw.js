// ============================================================
// SONORA - SERVICE WORKER (PWA + Offline Support)
// Handles: Audio stream caching, smart eviction, background sync
// ============================================================

const CACHE_NAME = 'sonora-v1';
const MAX_AUDIO_CACHE_MB = 300; // Keep max ~300 MB of audio cached locally
const MAX_AUDIO_CACHE_BYTES = MAX_AUDIO_CACHE_MB * 1024 * 1024;

// Static shell files - always cached for instant load
const STATIC_SHELL = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/covers/cover_spotify_tophits.svg'
];

// ==========================================
// Install: Cache the app shell
// ==========================================
self.addEventListener('install', event => {
  console.log('[SW] Installing Sonora Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_SHELL.filter(url => {
        // Don't fail install if some resources are missing
        return true;
      })).catch(err => {
        console.warn('[SW] Some shell files not cached:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ==========================================
// Activate: Clean old caches
// ==========================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating Sonora Service Worker...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ==========================================
// Fetch: Smart caching strategy
// ==========================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Audio streams: Network-first, then cache (Smart streaming proxy)
  if (url.pathname.startsWith('/api/stream/')) {
    event.respondWith(networkFirstAudio(event.request));
    return;
  }

  // API calls: Network-only (always fresh data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline - no network' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Static assets (CSS, JS, covers): Cache-first, then network
  event.respondWith(cacheFirstStatic(event.request));
});

// ==========================================
// Cache-First for static files
// ==========================================
async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.status < 400) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

// ==========================================
// Network-First for audio streams
// On success: cache the stream for offline replay
// Evict oldest cached audio if over size limit
// ==========================================
async function networkFirstAudio(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone and cache for offline/repeat play
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      // Background eviction to keep cache under limit
      evictAudioIfNeeded(cache);
    }
    return response;
  } catch (err) {
    // Offline fallback: check cache
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Audio unavailable offline', { status: 503 });
  }
}

// ==========================================
// Smart Audio Cache Eviction (LRU-style)
// Keeps total audio under MAX_AUDIO_CACHE_BYTES
// ==========================================
async function evictAudioIfNeeded(cache) {
  try {
    const keys = await cache.keys();
    const audioKeys = keys.filter(k => k.url.includes('/api/stream/'));

    let totalSize = 0;
    const entries = [];
    for (const key of audioKeys) {
      const resp = await cache.match(key);
      if (resp) {
        const blob = await resp.blob();
        entries.push({ key, size: blob.size });
        totalSize += blob.size;
      }
    }

    // Evict oldest entries first until under limit
    while (totalSize > MAX_AUDIO_CACHE_BYTES && entries.length > 0) {
      const oldest = entries.shift();
      await cache.delete(oldest.key);
      totalSize -= oldest.size;
      console.log('[SW] Evicted cached audio to free space:', oldest.key.url);
    }
  } catch (err) {
    console.warn('[SW] Eviction error:', err);
  }
}

// ==========================================
// Media Session API: Lock-screen controls
// (Forwarded from app via postMessage)
// ==========================================
self.addEventListener('message', event => {
  if (event.data?.type === 'UPDATE_MEDIA_SESSION') {
    // Just acknowledge - actual media session is set in app.js
    event.source?.postMessage({ type: 'SW_ACK' });
  }
});

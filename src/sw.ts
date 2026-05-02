import { version as appVersion } from '../package.json';

// export default null
declare let self: ServiceWorkerGlobalScope;

const cacheName = `superSplat-v${appVersion}`;

const cacheUrls = [
    './',
    './index.css',
    './index.html',
    './index.js',
    './index.js.map',
    './manifest.json',
    './static/icons/logo-192.png',
    './static/icons/logo-512.png',
    './static/images/screenshot-narrow.jpg',
    './static/images/screenshot-wide.jpg',
    './static/lib/lodepng/lodepng.js',
    './static/lib/lodepng/lodepng.wasm',
    './static/lib/webp/webp.mjs',
    './static/lib/webp/webp.wasm',
    './static/locales/de.json',
    './static/locales/en.json',
    './static/locales/fr.json',
    './static/locales/ja.json',
    './static/locales/ko.json',
    './static/locales/zh-CN.json'
];

self.addEventListener('install', (event) => {
    console.log(`installing v${appVersion}`);

    // create cache for current version
    event.waitUntil(
        caches.open(cacheName)
        .then((cache) => {
            return cache.addAll(cacheUrls);
        })
        .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    console.log(`activating v${appVersion}`);

    // delete the old caches once this one is activated
    event.waitUntil(
        caches.keys()
        .then((names) => {
            return Promise.all(names.map((name) => {
                return name !== cacheName ? caches.delete(name) : Promise.resolve(false);
            }));
        })
        .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
        .then(response => response ?? fetch(event.request))
    );
});

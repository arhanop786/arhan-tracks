import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// ------------------------------------------------------------------
// PWA precache: read public/sw.js, inject the full build file list
// (hashed assets + index.html + manifest + icons) as
// self.__ARHAN_PRECACHE__, and emit the patched service worker.
// public/sw.js itself is excluded from the verbatim copy so only the
// patched version ships.
// ------------------------------------------------------------------
function pwaPrecachePlugin(): Plugin {
  return {
    name: 'arhan-pwa-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const swPath = path.resolve(import.meta.dirname, 'public/sw.js');
      if (!existsSync(swPath)) return;
      const swSource = readFileSync(swPath, 'utf8');

      const urls = new Set<string>(['/']);
      for (const fileName of Object.keys(bundle)) {
        if (fileName === 'sw.js') continue;
        urls.add(`/${fileName}`);
      }
      for (const extra of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'maskable-icon.png']) {
        if (existsSync(path.resolve(import.meta.dirname, 'public', extra))) urls.add(`/${extra}`);
      }

      const list = JSON.stringify([...urls]);
      const patched = swSource.replace(
        /self\.__ARHAN_PRECACHE__\s*\|\|\s*\[\]/,
        `self.__ARHAN_PRECACHE__ = ${list}`,
      );
      if (patched === swSource) {
        this.warn('arhan-pwa-precache: could not inject precache manifest into sw.js');
        return;
      }

      // Drop Vite's verbatim copy of public/sw.js, emit the patched one.
      delete bundle['sw.js'];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: patched });
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaPrecachePlugin()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { target: 'es2020' },
});

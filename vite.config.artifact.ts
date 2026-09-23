import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// A SEPARATE build target used only to produce a single self-contained HTML
// file for an interim preview (e.g. a Claude Artifact link) so it can be
// opened immediately without a GitHub Pages deploy. The real deploy uses
// vite.config.ts (multi-file, PWA plugin, base '/propworks/'). This one
// has no service worker (published-artifact runtimes don't support it the
// same way) and runs local-only (no Supabase env vars baked in).
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
  },
})

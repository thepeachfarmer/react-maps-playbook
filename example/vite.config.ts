import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite's dev server and `vite preview` already fall back to index.html for
// unknown paths, so /s/<token> works in dev the same way nginx serves it in
// the container.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { sourcemap: false, chunkSizeWarningLimit: 800 },
});

import { defineConfig } from 'vite';

// Static single-page site: relative base keeps dist/ portable across any
// static host or file layout. No plugins, no external endpoints.
export default defineConfig({
  base: './',
});

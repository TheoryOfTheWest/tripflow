import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  base:
    process.env.VITE_BASE_PATH ||
    loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH ||
    '/tripflow/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('leaflet')) return 'map-vendor';
          if (id.includes('@supabase')) return 'cloud-vendor';
          if (id.includes('jszip') || id.includes('pako')) return 'backup-vendor';
          if (id.includes('luxon')) return 'time-vendor';
          if (id.includes('/zod/')) return 'validation-vendor';
          if (
            id.includes('react-dom') ||
            id.includes('/react/') ||
            id.includes('react-router') ||
            id.includes('/scheduler/')
          )
            return 'react-vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_GEOAPIFY_API_KEY: '' },
  },
}));

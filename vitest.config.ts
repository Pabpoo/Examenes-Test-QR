import { defineConfig } from 'vitest/config';

// Configuración aparte de vite.config.ts para que las pruebas no arranquen el entorno de Cloudflare.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});

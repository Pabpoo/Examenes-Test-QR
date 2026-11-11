import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:movil` arranca en modo «movil»: HTTPS con certificado propio y accesible desde la red local, para
// probar la cámara del móvil sin desplegar (la cámara solo funciona en contexto seguro).
export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare(), ...(mode === 'movil' ? [basicSsl()] : [])],
}));

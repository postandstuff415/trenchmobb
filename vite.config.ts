import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // The Kamino SDK depends on Orca's whirlpools core, which ships as WASM.
    wasm(),
    nodePolyfills({ include: ['buffer', 'crypto', 'stream', 'util', 'process'] }),
  ],
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});

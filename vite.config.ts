import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const testOutDir = process.env.APPELLA_TEST_OUT_DIR;

export default defineConfig({
  cacheDir: testOutDir ? `${testOutDir}/vite-cache` : undefined,
  // Loaded lazily by /rehearsal; pre-bundle it so the first visit doesn't trigger a dev reload.
  optimizeDeps: { include: ['@elevenlabs/client'] },
  plugins: [tailwindcss(), sveltekit({ adapter: adapter(), preprocess: vitePreprocess(), ...(testOutDir ? { outDir: testOutDir } : {}) })]
});

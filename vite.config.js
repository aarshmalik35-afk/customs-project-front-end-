import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages project sites, set base to '/your-repository-name/'.
  base: '/',
});

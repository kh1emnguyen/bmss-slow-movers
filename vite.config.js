import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Required for GitHub Pages deployment at kh1emnguyen.github.io/bmss-slow-movers/
  base: '/bmss-slow-movers/',
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // '/bmss-slow-movers/' for GitHub Pages, '/' for Cloudflare Pages
  base: '/bmss-slow-movers/',
})

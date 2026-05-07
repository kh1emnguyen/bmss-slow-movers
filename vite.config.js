import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // base: '/' for Cloudflare Pages (was '/bmss-slow-movers/' for GitHub Pages)
  base: '/',
})

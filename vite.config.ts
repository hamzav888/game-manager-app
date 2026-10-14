import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fixed port so it can be allow-listed as a Supabase OAuth redirect URL.
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
})

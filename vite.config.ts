import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
// singlefile: the production build is one self-contained index.html that runs
// from a double-click — no server, no install. See README "Run it".
export default defineConfig({ plugins: [react(), viteSingleFile()] })

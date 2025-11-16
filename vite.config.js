import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/web4/',   // ✅ 레포 이름과 똑같이!
  plugins: [react()],
})

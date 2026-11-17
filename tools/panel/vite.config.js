import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 面板读的是仓库根上的 routing/graph.json（唯一数据源），不复制副本
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@routing': resolve(__dirname, '../../routing/graph.json') },
  },
  server: {
    port: 5180,
    fs: { allow: [resolve(__dirname), resolve(__dirname, '../..')] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})

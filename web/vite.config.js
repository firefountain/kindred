import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: { port: 4310, proxy: { '/api': 'http://localhost:4311' } } });

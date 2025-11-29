// vite.config.js
import { defineConfig } from 'vite';
import dsv from '@rollup/plugin-dsv';

export default defineConfig({
  base: '/catching-attention/', // base public path when served in production
  plugins: [
    dsv(), // Add the dsv plugin
  ],
});
// vite.config.js
import { defineConfig } from 'vite';
import dsv from '@rollup/plugin-dsv';

export default defineConfig({
  plugins: [
    dsv(), // Add the dsv plugin
  ],
});
import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',use:{baseURL:process.env['TRACKS_URL']||'http://localhost:5080',headless:true,channel:process.env['PLAYWRIGHT_CHANNEL']||'chromium'},workers:1,reporter:'list'});

import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PY = JSON.stringify(path.resolve(__dirname, process.platform === 'win32' ? '../backend/.venv/Scripts/python.exe' : '../backend/.venv/bin/python'))
const ROOT = path.resolve(__dirname, '..')

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: [
    {
      command: `${PY} ${JSON.stringify(path.join(ROOT, "backend/scripts/e2e_server.py"))} 8010`,
      url: 'http://127.0.0.1:8010/api/health',
      env: { HAUL_DATA_DIR: path.join(ROOT, 'e2e-data') },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Real media files served locally so download tests don't depend on third-party sites
      command: `${PY} -m http.server 8011 --bind 127.0.0.1 --directory ${JSON.stringify(path.join(ROOT, "backend/tests/_assets"))}`,
      url: 'http://127.0.0.1:8011/small.mp4',
      reuseExistingServer: true,
    },
    {
      command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: { HAUL_API_URL: 'http://127.0.0.1:8010' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})

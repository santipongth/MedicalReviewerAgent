import { defineConfig, devices } from "@playwright/test";

// The app is served from a production build; every API call goes to a fake origin that the tests intercept,
// so e2e runs need no backend. PUBLIC_API_URL is read by the root layout at request time.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { PUBLIC_API_URL: "http://api.mock" },
  },
});

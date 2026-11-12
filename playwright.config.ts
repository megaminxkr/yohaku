import { defineConfig } from "@playwright/test";
const external = process.env.YOHAKU_TEST_URL;
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: external ?? "http://127.0.0.1:4173/yohaku/",
    timezoneId: "Asia/Tokyo",
    locale: "ja-JP",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  projects: [
    { name: "webkit-ipad", use: { browserName: "webkit", viewport: { width: 834, height: 1112 }, hasTouch: true, launchOptions: {} } },
    {
      name: "phone",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      use: { viewport: { width: 834, height: 1112 }, hasTouch: true },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: external
    ? undefined
    : {
        command: "npm run preview -- --port 4173",
        url: "http://127.0.0.1:4173/yohaku/",
        reuseExistingServer: !process.env.CI,
      },
});

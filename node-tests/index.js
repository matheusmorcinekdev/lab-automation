import fs from "fs";
import puppeteer from "puppeteer";

const url = process.argv[2] || "https://example.com";
const screenshotPath = process.argv[3] || "screenshot.png";
const memoryPath = process.argv[4] || "memory-report.txt";

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
    defaultViewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  });

  const page = await browser.newPage();

  // Use a mobile-like User Agent
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 " +
    "Mobile/15E148 Safari/604.1"
  );

  // Go to the page and wait for it to finish loading
  await page.goto(url, { waitUntil: "networkidle2", timeout: 180_000 });

  // Wait 1 minute to let ads and dynamic content finish loading
  await new Promise(resolve => setTimeout(resolve, 60_000));

  // === Capture memory data ===
  const client = await page.target().createCDPSession();
  const memoryData = await client.send("Memory.getAllTimeSamplingProfile");

  fs.writeFileSync(memoryPath, JSON.stringify(memoryData, null, 2));
  console.log(`Memory report saved to: ${memoryPath}`);

  // === Take a full-page screenshot ===
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  await browser.close();
})().catch(err => {
  console.error("[ERROR]", err);
  process.exit(1);
});

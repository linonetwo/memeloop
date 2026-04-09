/**
 * Screenshot tool: Capture screenshots of local applications or URLs
 * Inspired by Cursor 3's demo/screenshot feature for result verification
 */

import type { IToolRegistry } from "memeloop";
import { MEMELOOP_STRUCTURED_TOOL_KEY } from "memeloop";

export interface ScreenshotParams {
  url: string;
  selector?: string;
  fullPage?: boolean;
  waitForSelector?: string;
  timeout?: number;
}

export interface ScreenshotResult {
  success: boolean;
  imageBase64?: string;
  contentHash?: string;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

/**
 * Take a screenshot using puppeteer (headless Chrome)
 * Returns base64-encoded PNG image
 */
export async function takeScreenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
  try {
    // Dynamic import to avoid bundling puppeteer if not used
    const puppeteerModule = await import("puppeteer").catch(() => null);
    const puppeteer =
      puppeteerModule && typeof puppeteerModule === "object" && "launch" in puppeteerModule
        ? puppeteerModule
        : puppeteerModule &&
            typeof puppeteerModule === "object" &&
            puppeteerModule.default &&
            typeof puppeteerModule.default === "object" &&
            "launch" in puppeteerModule.default
          ? puppeteerModule.default
          : puppeteerModule &&
              typeof puppeteerModule === "object" &&
              puppeteerModule.default &&
              typeof puppeteerModule.default === "object" &&
              "default" in puppeteerModule.default &&
              puppeteerModule.default.default &&
              typeof puppeteerModule.default.default === "object" &&
              "launch" in puppeteerModule.default.default
            ? puppeteerModule.default.default
            : null;

    if (!puppeteer) {
      return {
        success: false,
        error: "puppeteer not installed. Run: npm install puppeteer",
      };
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate to URL
      await page.goto(params.url, {
        waitUntil: "networkidle2",
        timeout: params.timeout ?? 30000,
      });

      // Wait for specific selector if provided
      if (params.waitForSelector) {
        await page.waitForSelector(params.waitForSelector, {
          timeout: params.timeout ?? 30000,
        });
      }

      // Take screenshot
      let screenshotBuffer: Buffer;
      if (params.selector) {
        // Screenshot specific element
        const element = await page.$(params.selector);
        if (!element) {
          return {
            success: false,
            error: `Selector not found: ${params.selector}`,
          };
        }
        screenshotBuffer = (await element.screenshot({ type: "png" })) as Buffer;
      } else {
        // Screenshot full page or viewport
        screenshotBuffer = (await page.screenshot({
          type: "png",
          fullPage: params.fullPage ?? false,
        })) as Buffer;
      }

      // Convert to base64
      const imageBase64 = screenshotBuffer.toString("base64");

      // Calculate content hash for deduplication
      const crypto = await import("node:crypto");
      const contentHash = crypto.createHash("sha256").update(screenshotBuffer).digest("hex");

      return {
        success: true,
        imageBase64,
        contentHash,
        width: 1920,
        height: 1080,
        bytes: screenshotBuffer.length,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Register screenshot tool in the tool registry
 */
export function registerScreenshotTool(registry: IToolRegistry): void {
  registry.registerTool("screenshot", async (args: Record<string, unknown>) => {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url) {
      return { error: "Missing required 'url' parameter" };
    }

    const typedParams: ScreenshotParams = {
      url,
      selector: typeof args.selector === "string" ? args.selector : undefined,
      fullPage: typeof args.fullPage === "boolean" ? args.fullPage : undefined,
      waitForSelector: typeof args.waitForSelector === "string" ? args.waitForSelector : undefined,
      timeout: typeof args.timeout === "number" ? args.timeout : undefined,
    };

    const result = await takeScreenshot(typedParams);

    if (!result.success) {
      return {
        error: result.error,
        suggestion: "Make sure the URL is accessible and puppeteer is installed",
      };
    }

    return {
      ok: true,
      success: true,
      message: `Screenshot captured successfully (${result.width}x${result.height})`,
      contentHash: result.contentHash,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      imageBase64: result.imageBase64,
      [MEMELOOP_STRUCTURED_TOOL_KEY]: {
        summary:
          `Screenshot captured for ${typedParams.url} ` +
          `(${result.width ?? "?"}x${result.height ?? "?"}, ` +
          `${result.bytes ?? 0} bytes, hash=${result.contentHash ?? "unknown"})`,
      },
    };
  });
}

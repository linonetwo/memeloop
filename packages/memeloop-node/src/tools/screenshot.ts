/**
 * Screenshot tool: Capture screenshots of local applications or URLs
 * Inspired by Cursor 3's demo/screenshot feature for result verification
 */

import { defineTool } from "memeloop";
import type { IToolRegistry } from "memeloop";

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
  error?: string;
}

/**
 * Take a screenshot using puppeteer (headless Chrome)
 * Returns base64-encoded PNG image
 */
export async function takeScreenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
  try {
    // Dynamic import to avoid bundling puppeteer if not used
    const puppeteer = await import("puppeteer").catch(() => null);

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
  const tool = defineTool({
    name: "screenshot",
    description:
      "Take a screenshot of a URL or local application. Useful for verifying UI changes, capturing demo results, or visual testing. Returns base64-encoded PNG image.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to screenshot (e.g., http://localhost:3000 or https://example.com)",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to screenshot specific element instead of full page",
        },
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page instead of just viewport (default: false)",
        },
        waitForSelector: {
          type: "string",
          description: "Wait for this CSS selector to appear before taking screenshot",
        },
        timeout: {
          type: "number",
          description: "Maximum wait time in milliseconds (default: 30000)",
        },
      },
      required: ["url"],
    },
    async execute(params: unknown) {
      const typedParams = params as ScreenshotParams;
      const result = await takeScreenshot(typedParams);

      if (!result.success) {
        return {
          error: result.error,
          suggestion: "Make sure the URL is accessible and puppeteer is installed",
        };
      }

      // Return structured result with image data
      return {
        success: true,
        message: `Screenshot captured successfully (${result.width}x${result.height})`,
        contentHash: result.contentHash,
        imageBase64: result.imageBase64,
        // Truncate base64 in summary to avoid overwhelming the agent
        summary: `Screenshot of ${typedParams.url} captured (${result.imageBase64?.length ?? 0} bytes)`,
      };
    },
  });

  registry.registerTool(tool.id, tool.execute);
}

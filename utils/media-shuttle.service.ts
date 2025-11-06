import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { chromium, Browser, Page, BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

export interface MediaShuttleConfig {
  url: string;
  username: string;
  password: string;
  recipientEmail: string;
  headless?: boolean;
  timeout?: number;
}

export interface UploadResult {
  success: boolean;
  message: string;
  uploadedFiles?: string[];
  error?: string;
}

@Injectable()
export class MediaShuttleService {
  private readonly logger = new Logger(MediaShuttleService.name);
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private configService: ConfigService) {}

  async uploadToMediaShuttle(
    filePaths: string[],
    config: MediaShuttleConfig
  ): Promise<UploadResult> {
    let page: Page | null = null;

    try {
      if (!filePaths.every((filePath) => fs.existsSync(filePath))) {
        throw new BadRequestException(
          `Files not found: ${filePaths.join(", ")}`
        );
      }

      this.logger.log(
        `Starting Media Shuttle upload for files: ${filePaths.join(", ")}`
      );

      page = await this.initializeBrowser(config);

      await this.login(page, config);

      await this.performUpload(page, filePaths, config);

      this.logger.log("Media Shuttle upload completed successfully");

      return {
        success: true,
        message: "File uploaded to Media Shuttle successfully",
        uploadedFiles: filePaths.map((filePath) => path.basename(filePath)),
      };
    } catch (error) {
      this.logger.error("Media Shuttle upload failed:", error);

      if (page) {
        await this.captureErrorScreenshot(page);
      }

      return {
        success: false,
        message: "Failed to upload to Media Shuttle",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      await this.cleanup();
    }
  }

  async downloadFromMediaShuttle(config: MediaShuttleConfig): Promise<void> {
    this.logger.log("Starting Media Shuttle download process...");
    let page: Page | null = null;

    try {
      page = await this.initializeBrowser(config);

      await this.login(page, config);

      // TODO: perform Download
      await this.performDownload(page, config);

      this.logger.log("Media Shuttle download completed successfully");

      return;
    } catch (error) {
      this.logger.error("Download process failed:", error);

      if (page) {
        await this.captureErrorScreenshot(page);
      }

      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async initializeBrowser(config: MediaShuttleConfig): Promise<Page> {
    this.logger.log("Initializing browser...");

    this.browser = await chromium.launch({
      headless: false,
      // TODO: delete slowMo later
      slowMo: 500, // Delay each action by 500ms (adjust as needed)
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--allow-running-insecure-content",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await this.context.newPage();

    page.setDefaultTimeout(config.timeout ?? 30000);

    await page.goto(config.url);

    return page;
  }

  private async login(page: Page, config: MediaShuttleConfig): Promise<void> {
    this.logger.log("Attempting to login to Media Shuttle...");

    try {
      // Wait for the page to load
      await page.waitForLoadState("domcontentloaded");

      // Step 1: Fill in the email
      await page.locator("#login-form-email").fill(config.username);

      // Click the "Next" button to proceed to password step
      await page.getByRole("button", { name: /next/i }).click();

      // Wait for the password field to appear
      await page.waitForSelector("#login-form-password", { state: "visible" });

      // Step 2: Fill in the password
      await page.locator("#login-form-password").fill(config.password);

      // Click the login/submit button
      await page.getByRole("button", { name: /login|sign in|submit/i }).click();

      await page.waitForLoadState("networkidle");

      const currentUrl = page.url();
      if (currentUrl.includes("login") || currentUrl.includes("signin")) {
        throw new Error("Login failed - still on login page");
      }

      this.logger.log("Successfully logged in to Media Shuttle");
    } catch (error) {
      this.logger.error("Login failed:", error);
      throw new Error(
        `Login failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async performUpload(
    page: Page,
    filePaths: string[],
    config: MediaShuttleConfig
  ): Promise<void> {
    this.logger.log("Starting file upload process...");

    try {
      const transferWithoutAppButton = page.locator("#mst-no-software-btn");
      if (await transferWithoutAppButton.isVisible().catch(() => false)) {
        this.logger.log('Found "Transfer Without App" button, clicking it...');
        await transferWithoutAppButton.click();
      }

      //set recipient email

      const recipientEmailInput = page.locator('input[title="To"]');
      if (await recipientEmailInput.isVisible().catch(() => false)) {
        await recipientEmailInput.fill(config.recipientEmail);
      }

      const addFilesButton = page.locator("#addFilesButton");
      if (await addFilesButton.isVisible().catch(() => false)) {
        const fileChooserPromise = page.waitForEvent("filechooser");
        await addFilesButton.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePaths);

        const sendButton = page.locator("#transferButton");
        if (await sendButton.isVisible().catch(() => false)) {
          await sendButton.click();
        }
      }

      await this.waitForUploadCompletion(page);
    } catch (error) {
      this.logger.error("Upload process failed:", error);
      throw new Error(
        `Upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async performDownload(
    page: Page,
    config: MediaShuttleConfig
  ): Promise<void> {
    this.logger.log("Starting file download process...");

    const logFilterConditions = {
      titlePrefix: "Received",
      lastSync: new Date("2025-11-05T23:59:59"),
    };

    const filesFilterConditions = {
      nameSuffix: "OptimAI.xlsx",
    };

    let foundMatchedLog = false;
    let matchedLog = null;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50;

    try {
      // Click transferWithoutAppButton
      const transferWithoutAppButton = page.locator("#mst-no-software-btn");
      if (await transferWithoutAppButton.isVisible().catch(() => false)) {
        this.logger.log('Found "Transfer Without App" button, clicking it...');
        await transferWithoutAppButton.click();
      }

      // Click myTransfersButton
      const myTransfersButton = page.locator("#portal-activity-button");
      if (await myTransfersButton.isVisible().catch(() => false)) {
        this.logger.log('Found "My Transfers Button" button, clicking it...');
        await myTransfersButton.click();
      }

      // Collect activity items
      const activityDialog = page.locator("#activity");
      if (await activityDialog.isVisible().catch(() => false)) {
        this.logger.log(
          'Found "Activity dialog", process to filter activities...'
        );

        const activityItemsContainer =
          activityDialog.locator(".activity-items");

        while (!foundMatchedLog && scrollAttempts < maxScrollAttempts) {
          const activityItemsLocator = activityDialog.locator(".activity-item");
          const activityItemsCount = await activityItemsLocator.count();

          this.logger.log(
            `Scroll attempt ${
              scrollAttempts + 1
            }: Found ${activityItemsCount} activity items`
          );

          if (activityItemsCount === 0) {
            this.logger.log("No activity items found");
            break;
          }

          const activityItems = await activityItemsLocator.all();
          for (const item of activityItems) {
            const fileName = await item
              .locator(".activity-item__subtext")
              .textContent();

            const title = await item
              .locator(".activity-item__info b")
              .textContent();

            const fileNameTrimmed = fileName?.trim() || "";
            const titleTrimmed = title?.trim() || "";

            const matchesTitle = logFilterConditions.titlePrefix
              ? titleTrimmed.startsWith(logFilterConditions.titlePrefix)
              : true;

            if (matchesTitle) {
              this.logger.log(
                `✓ Found matching item - Title: "${titleTrimmed}"`
              );
              matchedLog = {
                fileName: fileNameTrimmed,
                element: item,
              };
              foundMatchedLog = true;
              break;
            }
          }

          if (!foundMatchedLog) {
            this.logger.log("No match found, scrolling down...");

            await activityItemsContainer.evaluate((container) => {
              container.scrollTop = container.scrollTop + 300; // Scroll down 300px
            });

            await page.waitForTimeout(800);
            scrollAttempts++;
          }
        }

        if (!matchedLog) {
          this.logger.warn("No matching activity item found after scrolling");
          return;
        }

        this.logger.log(`Processing matched item: ${matchedLog.fileName}`);

        if (await matchedLog.element.isVisible().catch(() => false)) {
          this.logger.log(
            `Clicking on activity item: ${matchedLog.fileName}...`
          );
          await matchedLog.element.click();
        }

        await page.waitForTimeout(1000);

        const activitySubtitle = page
          .locator(".activity-description__subtitle")
          .first();

        if (!(await activitySubtitle.isVisible().catch(() => false))) {
          this.logger.warn("Activity subtitle not found!");
          return;
        }

        const subtitleText = await activitySubtitle.textContent();
        const subtitleTrimmed = subtitleText?.trim() || "";

        const activityTimestamp = new Date(subtitleTrimmed);

        if (logFilterConditions.lastSync >= activityTimestamp) {
          this.logger.warn(
            `Skipping: Activity date (${activityTimestamp.toLocaleString()})`
          );
          return;
        }
        this.logger.log(`Timestamp check passed, proceeding...`);

        const dropDownMenuButton = page.locator(
          ".activity-icon--medium.pa-details__menu-icon.fas.fa-ellipsis-v"
        );
        if (await dropDownMenuButton.isVisible().catch(() => false)) {
          this.logger.log("Found Dropdown menu button, clicking it...");
          await dropDownMenuButton.click();
        }

        const dropdownDownloadOption = page
          .locator(".activity-dropdown__text")
          .filter({ hasText: "Download" });

        if (await dropdownDownloadOption.isVisible().catch(() => false)) {
          this.logger.log("Found Download option, clicking it...");
          await dropdownDownloadOption.click();

          this.logger.log("Waiting for navigation to download page...");
          await page.waitForURL("**/download.jsp**", { timeout: 10000 });
          this.logger.log(`Navigated to: ${page.url()}`);

          const transferWithoutAppButton = page.locator("#mst-no-software-btn");
          if (await transferWithoutAppButton.isVisible().catch(() => false)) {
            this.logger.log(
              'Found "Transfer Without App" button, clicking it...'
            );
            await transferWithoutAppButton.click();
          }

          // Collect files to download
          this.logger.log("Collecting files in download page...");
          const fileItemsLocator = page.locator(".jstree-anchor");
          const fileItemsCount = await fileItemsLocator.count();

          this.logger.log(`Found ${fileItemsCount} total files`);
          if (fileItemsCount === 0) return;

          const filteredFiles = [];
          const fileItems = await fileItemsLocator.all();

          for (const item of fileItems) {
            const fileNameText = await item.textContent();
            const fileNameTrimmed = fileNameText?.trim() || "";
            const matchesSuffix = filesFilterConditions.nameSuffix
              ? fileNameTrimmed.endsWith(filesFilterConditions.nameSuffix)
              : true;

            if (matchesSuffix) {
              filteredFiles.push({
                fileName: fileNameTrimmed,
                element: item,
              });
            }
          }

          const filteredFileCount = filteredFiles.length;
          this.logger.log(
            `Filtered to ${filteredFileCount} files matching conditions`
          );
          if (filteredFileCount === 0) return;

          for (const file of filteredFiles) {
            this.logger.log(`Selecting file: ${file.fileName}`);
            await file.element.click({
              modifiers: ["Control"],
            });
            await page.waitForTimeout(300); // Small delay between clicks
          }

          const downloadPromise = page.waitForEvent("download");

          const finalDownloadButton = page.locator(
            'span[data-lingua="downloadButton"]'
          );
          if (await finalDownloadButton.isVisible().catch(() => false)) {
            this.logger.log("Found Final Download button, clicking it...");
            await finalDownloadButton.click();

            this.logger.log("Waiting for download to start...");
            const download = await downloadPromise;

            const suggestedFilename = download.suggestedFilename();
            this.logger.log(`Download started: ${suggestedFilename}`);

            const downloadPath = path.join(
              "D:\\MayoDownload",
              suggestedFilename
            );

            await download.saveAs(downloadPath);
            this.logger.log(`File saved to: ${downloadPath}`);

            // Check zip file and extract
            if (suggestedFilename.endsWith(".zip")) {
              this.logger.log("Detected zip file, extracting...");

              const extractDir = path.join(
                "D:\\MayoDownload",
                path.basename(suggestedFilename, ".zip")
              );

              if (!fs.existsSync(extractDir)) {
                fs.mkdirSync(extractDir, { recursive: true });
              }

              await this.extractZipFile(downloadPath, extractDir);
              this.logger.log(`Files extracted to: ${extractDir}`);

              fs.unlinkSync(downloadPath);
              this.logger.log("Zip file deleted after extraction");
            }
          }
        }
      }
    } catch (error) {
      this.logger.error("Download process failed:", error);
      throw new Error(
        `Download failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async waitForUploadCompletion(page: Page): Promise<void> {
    this.logger.log("Waiting for Media Shuttle transfer completion...");

    try {
      await page.waitForSelector("#transferProgressDetails", {
        timeout: 10000,
      });

      this.logger.log(
        "Transfer progress details found, monitoring completion..."
      );

      await this.monitorTransferProgress(page);

      this.logger.log("Media Shuttle transfer completed successfully");
    } catch {
      this.logger.warn(
        "Could not detect transfer completion, checking for error messages..."
      );

      const errorMessage = await page
        .locator(
          '.error, .upload-error, [data-testid*="error"], #transferStatus'
        )
        .first()
        .textContent()
        .catch(() => null);

      if (errorMessage && errorMessage.toLowerCase().includes("error")) {
        throw new Error(`Transfer failed: ${errorMessage}`);
      }

      this.logger.log("No error detected, assuming transfer completed");
    }
  }

  private async monitorTransferProgress(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const topText = document.querySelector("#topText");

        if (!topText) return false;

        const topTextContent = topText.textContent?.toLowerCase() || "";
        const isCompleted =
          topTextContent.includes("completed") ||
          topTextContent.includes("success") ||
          topTextContent.includes("finished");

        if (isCompleted) {
          this.logger.log(
            "Transfer completed detected via topText:",
            topTextContent
          );
          return true;
        }

        return false;
      },
      { timeout: 300000 }
    );
  }

  private async captureErrorScreenshot(page: Page): Promise<void> {
    try {
      const screenshotPath = path.join(
        process.cwd(),
        "logs",
        `media-shuttle-error-${Date.now()}.png`
      );

      if (!fs.existsSync(path.dirname(screenshotPath))) {
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.logger.log(`Error screenshot saved: ${screenshotPath}`);
    } catch (screenshotError) {
      this.logger.error("Failed to capture error screenshot:", screenshotError);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      this.logger.error("Error during cleanup:", error);
    }
  }

  async testConnection(config: MediaShuttleConfig): Promise<boolean> {
    let page: Page | null = null;

    try {
      page = await this.initializeBrowser(config);
      await this.login(page, config);
      return true;
    } catch (error) {
      this.logger.error("Connection test failed:", error);
      return false;
    } finally {
      await this.cleanup();
    }
  }

  private async extractZipFile(
    zipPath: string,
    extractTo: string
  ): Promise<void> {
    const AdmZip = require("adm-zip");

    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractTo, true);
      this.logger.log(`Successfully extracted ${zipPath}`);
    } catch (error) {
      this.logger.error("Failed to extract zip file:", error);
      throw new Error(
        `Extraction failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

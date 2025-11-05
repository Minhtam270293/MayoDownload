import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

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
    config: MediaShuttleConfig,
  ): Promise<UploadResult> {
    let page: Page | null = null;

    try {
      if (!filePaths.every((filePath) => fs.existsSync(filePath))) {
        throw new BadRequestException(
          `Files not found: ${filePaths.join(', ')}`,
        );
      }

      this.logger.log(
        `Starting Media Shuttle upload for files: ${filePaths.join(', ')}`,
      );

      page = await this.initializeBrowser(config);

      await this.login(page, config);

      await this.performUpload(page, filePaths, config);

      this.logger.log('Media Shuttle upload completed successfully');

      return {
        success: true,
        message: 'File uploaded to Media Shuttle successfully',
        uploadedFiles: filePaths.map((filePath) => path.basename(filePath)),
      };
    } catch (error) {
      this.logger.error('Media Shuttle upload failed:', error);

      if (page) {
        await this.captureErrorScreenshot(page);
      }

      return {
        success: false,
        message: 'Failed to upload to Media Shuttle',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await this.cleanup();
    }
  }

  private async initializeBrowser(config: MediaShuttleConfig): Promise<Page> {
    this.logger.log('Initializing browser...');

    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--allow-running-insecure-content',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await this.context.newPage();

    page.setDefaultTimeout(config.timeout ?? 30000);

    await page.goto(config.url);

    return page;
  }

  private async login(page: Page, config: MediaShuttleConfig): Promise<void> {
    this.logger.log('Attempting to login to Media Shuttle...');

    try {
      // Wait for the page to load
      await page.waitForLoadState('domcontentloaded');

      // Step 1: Fill in the email
      await page.locator('#login-form-email').fill(config.username);

      // Click the "Next" button to proceed to password step
      await page.getByRole('button', { name: /next/i }).click();

      // Wait for the password field to appear
      await page.waitForSelector('#login-form-password', { state: 'visible' });

      // Step 2: Fill in the password
      await page.locator('#login-form-password').fill(config.password);

      // Click the login/submit button
      await page.getByRole('button', { name: /login|sign in|submit/i }).click();

      await page.waitForLoadState('networkidle');

      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        throw new Error('Login failed - still on login page');
      }

      this.logger.log('Successfully logged in to Media Shuttle');
    } catch (error) {
      this.logger.error('Login failed:', error);
      throw new Error(
        `Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async performUpload(
    page: Page,
    filePaths: string[],
    config: MediaShuttleConfig,
  ): Promise<void> {
    this.logger.log('Starting file upload process...');

    try {
      const transferWithoutAppButton = page.locator('#mst-no-software-btn');
      if (await transferWithoutAppButton.isVisible().catch(() => false)) {
        this.logger.log('Found "Transfer Without App" button, clicking it...');
        await transferWithoutAppButton.click();
      }

      //set recipient email

      const recipientEmailInput = page.locator('input[title="To"]');
      if (await recipientEmailInput.isVisible().catch(() => false)) {
        await recipientEmailInput.fill(config.recipientEmail);
      }

      const addFilesButton = page.locator('#addFilesButton');
      if (await addFilesButton.isVisible().catch(() => false)) {
        const fileChooserPromise = page.waitForEvent('filechooser');
        await addFilesButton.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePaths);

        const sendButton = page.locator('#transferButton');
        if (await sendButton.isVisible().catch(() => false)) {
          await sendButton.click();
        }
      }

      await this.waitForUploadCompletion(page);
    } catch (error) {
      this.logger.error('Upload process failed:', error);
      throw new Error(
        `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async waitForUploadCompletion(page: Page): Promise<void> {
    this.logger.log('Waiting for Media Shuttle transfer completion...');

    try {
      await page.waitForSelector('#transferProgressDetails', {
        timeout: 10000,
      });

      this.logger.log(
        'Transfer progress details found, monitoring completion...',
      );

      await this.monitorTransferProgress(page);

      this.logger.log('Media Shuttle transfer completed successfully');
    } catch {
      this.logger.warn(
        'Could not detect transfer completion, checking for error messages...',
      );

      const errorMessage = await page
        .locator(
          '.error, .upload-error, [data-testid*="error"], #transferStatus',
        )
        .first()
        .textContent()
        .catch(() => null);

      if (errorMessage && errorMessage.toLowerCase().includes('error')) {
        throw new Error(`Transfer failed: ${errorMessage}`);
      }

      this.logger.log('No error detected, assuming transfer completed');
    }
  }

  private async monitorTransferProgress(page: Page): Promise<void> {
    await page.waitForFunction(
      () => {
        const topText = document.querySelector('#topText');

        if (!topText) return false;

        const topTextContent = topText.textContent?.toLowerCase() || '';
        const isCompleted =
          topTextContent.includes('completed') ||
          topTextContent.includes('success') ||
          topTextContent.includes('finished');

        if (isCompleted) {
          this.logger.log(
            'Transfer completed detected via topText:',
            topTextContent,
          );
          return true;
        }

        return false;
      },
      { timeout: 300000 },
    );
  }

  private async captureErrorScreenshot(page: Page): Promise<void> {
    try {
      const screenshotPath = path.join(
        process.cwd(),
        'logs',
        `media-shuttle-error-${Date.now()}.png`,
      );

      if (!fs.existsSync(path.dirname(screenshotPath))) {
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.logger.log(`Error screenshot saved: ${screenshotPath}`);
    } catch (screenshotError) {
      this.logger.error('Failed to capture error screenshot:', screenshotError);
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
      this.logger.error('Error during cleanup:', error);
    }
  }

  async testConnection(config: MediaShuttleConfig): Promise<boolean> {
    let page: Page | null = null;

    try {
      page = await this.initializeBrowser(config);
      await this.login(page, config);
      return true;
    } catch (error) {
      this.logger.error('Connection test failed:', error);
      return false;
    } finally {
      await this.cleanup();
    }
  }
}

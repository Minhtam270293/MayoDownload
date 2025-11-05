import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IFileUploader,
  UploadResult,
} from '../interfaces/file-uploader.interface';
import { FileData } from '../interfaces/file-downloader.interface';
import {
  MediaShuttleService,
  MediaShuttleConfig,
} from '../media-shuttle.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class MayoUploaderService implements IFileUploader {
  private readonly logger = new Logger(MayoUploaderService.name);

  constructor(
    private readonly mediaShuttleService: MediaShuttleService,
    private readonly configService: ConfigService,
  ) {}

  async upload(files: FileData[]): Promise<UploadResult[]> {
    this.logger.log(`[MAYO] Uploading ${files.length} files via Media Shuttle`);

    const reportFiles = files.filter((file) =>
      file.fileName.endsWith('_Report.docx'),
    );

    const skippedFiles = files.filter(
      (file) => !file.fileName.endsWith('_Report.docx'),
    );

    if (skippedFiles.length > 0) {
      this.logger.log(
        `[MAYO] Skipping ${skippedFiles.length} non-report files: ${skippedFiles.map((f) => f.fileName).join(', ')}`,
      );
    }

    if (reportFiles.length === 0) {
      this.logger.log(
        `[MAYO] No files ending with '_Report.docx' found. Skipping upload.`,
      );
      return skippedFiles.map((file) => ({
        fileName: file.fileName,
        success: true,
        skipped: true,
      }));
    }

    this.logger.log(
      `[MAYO] Uploading ${reportFiles.length} report files (filtered from ${files.length} total files)`,
    );

    const results: UploadResult[] = [];
    const tempFilePaths: string[] = [];

    // Get Media Shuttle configuration
    const mediaShuttleConfig = this.getMediaShuttleConfig();

    try {
      for (const file of reportFiles) {
        if (!file.data) {
          throw new Error(`File data is missing for ${file.fileName}`);
        }

        const tempDir = os.tmpdir();
        const tempFilePath = path.join(tempDir, file.fileName);

        fs.writeFileSync(tempFilePath, file.data);
        tempFilePaths.push(tempFilePath);

        this.logger.log(`[MAYO] Created temp file: ${file.fileName}`);
      }

      this.logger.log(
        `[MAYO] Starting batch upload of ${tempFilePaths.length} files`,
      );
      const uploadResult = await this.mediaShuttleService.uploadToMediaShuttle(
        tempFilePaths,
        mediaShuttleConfig,
      );

      if (uploadResult.success) {
        for (const file of reportFiles) {
          results.push({
            fileName: file.fileName,
            success: true,
          });
        }
        this.logger.log(
          `[MAYO] Successfully uploaded all ${reportFiles.length} report files`,
        );
      } else {
        const errorMessage = uploadResult.error || 'Batch upload failed';
        for (const file of reportFiles) {
          results.push({
            fileName: file.fileName,
            success: false,
            errorMessage: errorMessage,
          });
        }
        this.logger.error(`[MAYO] Batch upload failed: ${errorMessage}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[MAYO] Failed to upload files: ${errorMessage}`);

      for (const file of reportFiles) {
        results.push({
          fileName: file.fileName,
          success: false,
          errorMessage: errorMessage,
        });
      }
    } finally {
      // Clean up all temporary files
      for (const tempFilePath of tempFilePaths) {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            this.logger.log(
              `[MAYO] Cleaned up temp file: ${path.basename(tempFilePath)}`,
            );
          }
        } catch (cleanupError) {
          this.logger.warn(
            `[MAYO] Failed to cleanup temp file ${path.basename(tempFilePath)}: ${cleanupError}`,
          );
        }
      }
    }

    for (const file of skippedFiles) {
      results.push({
        fileName: file.fileName,
        success: true,
        skipped: true,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(
      `[MAYO] Upload completed: ${successCount}/${files.length} files succeeded (${reportFiles.length} uploaded, ${skippedFiles.length} skipped)`,
    );

    return results;
  }

  private getMediaShuttleConfig(): MediaShuttleConfig {
    const config = this.configService.get<MediaShuttleConfig>('mediaShuttle');

    if (!config) {
      throw new Error('Media Shuttle configuration not found');
    }

    return {
      url: config.url,
      username: config.username,
      password: config.password,
      headless: config.headless,
      timeout: config.timeout,
      recipientEmail: config.recipientEmail,
    };
  }
}

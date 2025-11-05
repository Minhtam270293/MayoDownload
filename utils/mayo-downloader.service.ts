import { Injectable, Logger } from "@nestjs/common";
import {
  IFileDownloader,
  FileData,
} from "../interfaces/file-downloader.interface";
import {
  MediaShuttleService,
  MediaShuttleConfig,
} from "./media-shuttle.service";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class MayoDownloaderService implements IFileDownloader {
  private readonly logger = new Logger(MayoDownloaderService.name);

  constructor(
    private readonly mediaShuttleService: MediaShuttleService,
    private readonly configService: ConfigService
  ) {
    console.log("ConfigService injected:", this.configService);
    console.log("MediaShuttleService injected:", this.mediaShuttleService);
  }

  async download(): Promise<FileData[]> {
    this.logger.log(`[MAYO] Downloading files via Media Shuttle`);
    try {
      const config = this.getMediaShuttleConfig();
      await this.mediaShuttleService.downloadFromMediaShuttle(config);
      // For now, return an empty array
      return [];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[MAYO] Download failed: ${errorMessage}`);
      throw error;
    }
  }

  private getMediaShuttleConfig(): MediaShuttleConfig {
    const config = this.configService.get<MediaShuttleConfig>("mediaShuttle");

    if (!config) {
      throw new Error("Media Shuttle configuration not found");
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

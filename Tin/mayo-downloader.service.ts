import { Injectable, Logger } from '@nestjs/common';
import {
  IFileDownloader,
  FileData,
} from '../interfaces/file-downloader.interface';

@Injectable()
export class MayoDownloaderService implements IFileDownloader {
  private readonly logger = new Logger(MayoDownloaderService.name);

  async download(lastSyncTime: Date): Promise<FileData[]> {
    this.logger.log(
      `[MAYO] Downloading files updated after ${lastSyncTime.toISOString()}`,
    );

    try {
      // TODO: Implement actual S3 API call to download MAYO files
      // For now, return mock data
      const now = new Date();
      const files: FileData[] = [
        {
          fileName: 'mayo_file_01.txt',
          filePath: 'mayo/input/mayo_file_01.txt',
          type: 'MAYO',
          data: Buffer.from('Mock MAYO file content'),
          updatedAt: new Date(now.getTime() - 1000 * 60 * 60),
        },
      ];

      this.logger.log(`[MAYO] Downloaded ${files.length} files`);
      return await Promise.resolve(files);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[MAYO] Download failed: ${errorMessage}`);
      throw error;
    }
  }
}

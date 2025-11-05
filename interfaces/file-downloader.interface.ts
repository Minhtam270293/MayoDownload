export interface FileData {
  fileName: string;
  filePath?: string;
  type: string;
  status?: string;
  statusHistory?: Record<string, string>;
  data?: Buffer;
  updatedAt?: Date;
}

export interface IFileDownloader {
  /**
   * Download and filter files based on lastSyncTime
   * @param lastSyncTime - Last successful sync timestamp
   * @returns Array of files with their data
   */
  // download(lastSyncTime: Date): Promise<FileData[]>;

  // test: delete later
  download(lastSyncTime: Date): Promise<FileData[]>;
}

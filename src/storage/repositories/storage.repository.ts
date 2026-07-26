export interface StoredFileInput {
  buffer: Buffer;
  mimetype: string;
  originalName: string;
}

export interface StoredFile {
  /** URL the frontend can load the file from directly (served statically
   * for the local-disk adapter; a real object-storage URL for any future
   * cloud adapter — callers never need to know which). */
  url: string;
}

/**
 * Swappable file-storage boundary — mirrors this project's Repository
 * Pattern used for data access (see CLAUDE.md), so a future cloud adapter
 * (S3/Azure Blob) can replace LocalDiskStorageRepository without touching
 * any controller/service that saves/deletes files.
 */
export interface StorageRepository {
  save(file: StoredFileInput, folder: string): Promise<StoredFile>;
  delete(url: string): Promise<void>;
}

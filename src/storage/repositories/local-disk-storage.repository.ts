import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { StorageRepository, StoredFile, StoredFileInput } from './storage.repository';

// Root directory files are written under, and the path prefix they're
// served from (wired up in main.ts via app.useStaticAssets). Kept as
// constants here (not env-configurable) since this adapter only exists for
// local/dev use — a real cloud adapter would replace it entirely rather
// than reading the same config.
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');
export const UPLOADS_URL_PREFIX = '/uploads';

@Injectable()
export class LocalDiskStorageRepository implements StorageRepository {
  async save(file: StoredFileInput, folder: string): Promise<StoredFile> {
    const dir = join(UPLOADS_ROOT, folder);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}${extname(file.originalName)}`;
    const fullPath = join(dir, filename);
    await writeFile(fullPath, file.buffer);

    return { url: `${UPLOADS_URL_PREFIX}/${folder}/${filename}` };
  }

  async delete(url: string): Promise<void> {
    if (!url.startsWith(UPLOADS_URL_PREFIX)) return;
    const relativePath = url.slice(UPLOADS_URL_PREFIX.length);
    const fullPath = join(UPLOADS_ROOT, relativePath);
    try {
      await unlink(fullPath);
    } catch (error: any) {
      // Already gone (e.g. manual cleanup) — deleting an ItemImage row
      // shouldn't fail just because the underlying file is missing.
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

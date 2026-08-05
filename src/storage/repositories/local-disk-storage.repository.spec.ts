import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LocalDiskStorageRepository as LocalDiskStorageRepositoryType } from './local-disk-storage.repository';

// UPLOADS_ROOT is computed from process.cwd() at module-load time, so each
// test isolates a fresh module instance under a mocked cwd pointing at a
// real temp directory — this exercises actual filesystem I/O (the whole
// point of this adapter) rather than mocking fs itself.
describe('LocalDiskStorageRepository', () => {
  function loadRepositoryAgainst(cwd: string): LocalDiskStorageRepositoryType {
    let RepositoryClass!: typeof LocalDiskStorageRepositoryType;
    jest.isolateModules(() => {
      jest.spyOn(process, 'cwd').mockReturnValue(cwd);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      RepositoryClass = require('./local-disk-storage.repository').LocalDiskStorageRepository;
    });
    return new RepositoryClass();
  }

  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'webprolific-storage-test-'));
    jest.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('save writes the file under uploads/<folder> and returns a served URL', async () => {
    const repository = loadRepositoryAgainst(tempDir);
    const { url } = await repository.save(
      { buffer: Buffer.from('hello'), mimetype: 'image/png', originalName: 'photo.png' },
      'items/i1',
    );

    expect(url).toMatch(/^\/uploads\/items\/i1\/[0-9a-f-]+\.png$/);

    const relativePath = url.replace('/uploads/', '');
    const fullPath = join(tempDir, 'uploads', relativePath);
    expect(existsSync(fullPath)).toBe(true);
    expect(readFileSync(fullPath, 'utf8')).toBe('hello');
  });

  it('delete removes the previously-saved file', async () => {
    const repository = loadRepositoryAgainst(tempDir);
    const { url } = await repository.save(
      { buffer: Buffer.from('bye'), mimetype: 'image/png', originalName: 'photo.png' },
      'items/i1',
    );
    const fullPath = join(tempDir, 'uploads', url.replace('/uploads/', ''));
    expect(existsSync(fullPath)).toBe(true);

    await repository.delete(url);

    expect(existsSync(fullPath)).toBe(false);
  });

  it('delete on an already-missing file does not throw', async () => {
    const repository = loadRepositoryAgainst(tempDir);
    await expect(repository.delete('/uploads/items/i1/does-not-exist.png')).resolves.toBeUndefined();
  });

  it('delete ignores urls outside the uploads prefix', async () => {
    const repository = loadRepositoryAgainst(tempDir);
    await expect(repository.delete('https://example.com/not-ours.png')).resolves.toBeUndefined();
  });
});

import { Module } from '@nestjs/common';
import { STORAGE_REPOSITORY } from './repositories/tokens';
import { LocalDiskStorageRepository } from './repositories/local-disk-storage.repository';

@Module({
  providers: [{ provide: STORAGE_REPOSITORY, useClass: LocalDiskStorageRepository }],
  exports: [STORAGE_REPOSITORY],
})
export class StorageModule {}

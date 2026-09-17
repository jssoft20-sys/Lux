import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { ClamAvService } from './clamav.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, ClamAvService, StorageService],
  exports: [FilesService, ClamAvService, StorageService],
})
export class FilesModule {}

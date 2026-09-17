import { Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { FileKind } from '@prisma/client';
import { memoryStorage } from 'multer';
import { FilesService } from './files.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { E } from '../common/errors';
import { clientIp } from '../common/utils/request';
import { ActiveUserGuard } from '../auth/guards/status.guard';
import { Throttle } from '@nestjs/throttler';

const USER_KINDS: FileKind[] = [FileKind.RECEIPT, FileKind.AVATAR, FileKind.DISPUTE_EVIDENCE, FileKind.CHAT, FileKind.SUPPORT];

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @UseGuards(ActiveUserGuard)
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Query('kind') kind: string, @Req() req: Request) {
    if (!file) throw E.bad('NO_FILE', 'Файл не передан');
    const k = (kind || 'RECEIPT').toUpperCase() as FileKind;
    if (!USER_KINDS.includes(k)) throw E.bad('BAD_KIND', 'Недопустимый тип файла');
    const result = await this.files.upload(user.id, k, file.buffer, file.originalname, clientIp(req));
    if (k === FileKind.AVATAR) await this.files.setAvatar(user.id, result.id);
    return result;
  }

  @Get(':id')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    if (!(await this.files.canAccess(id, user.id))) throw E.forbidden();
    const { file, stream } = await this.files.stream(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${file.id}.${file.storageKey.split('.').pop()}"`);
    stream.pipe(res);
  }
}

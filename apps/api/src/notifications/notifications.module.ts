import { Global, Module } from '@nestjs/common';
import { WappiService } from './wappi.service';
import { MailService } from './mail.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [WappiService, MailService, NotificationsService],
  exports: [WappiService, MailService, NotificationsService],
})
export class NotificationsModule {}

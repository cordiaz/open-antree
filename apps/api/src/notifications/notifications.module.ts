import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationsService,
  WHATSAPP_SENDER,
} from './notifications.service.js';
import { createSender } from './whatsapp.js';

// Global so the queue service can enqueue messages without importing it.
@Global()
@Module({
  providers: [
    NotificationsService,
    {
      provide: WHATSAPP_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createSender((key) => config.get<string>(key) || undefined),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

import { Global, Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

// Global so the queue and admin services can publish without importing it.
@Global()
@Module({
  imports: [QueueModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}

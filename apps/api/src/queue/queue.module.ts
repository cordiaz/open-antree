import { Module } from '@nestjs/common';
import { OperatorController } from './operator.controller.js';
import { PublicController } from './public.controller.js';
import { QueueService } from './queue.service.js';

@Module({
  controllers: [PublicController, OperatorController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

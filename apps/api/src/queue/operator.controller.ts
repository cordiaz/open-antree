import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CallNextDto } from './dto.js';
import { QueueService } from './queue.service.js';

// Operator endpoints. Not authenticated yet: anyone who knows a counter id can
// operate it. Authentication is a later phase.
@Controller('tenants/:slug')
export class OperatorController {
  constructor(private readonly queue: QueueService) {}

  @Get('stats')
  getStats(
    @Param('slug') slug: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.queue.getStats(slug, branchId);
  }

  @Get('counters/:counterId')
  getCounter(
    @Param('slug') slug: string,
    @Param('counterId', ParseUUIDPipe) counterId: string,
  ) {
    return this.queue.getCounter(slug, counterId);
  }

  @Post('counters/:counterId/call-next')
  @HttpCode(200)
  callNext(
    @Param('slug') slug: string,
    @Param('counterId', ParseUUIDPipe) counterId: string,
    // The body is optional; Express 5 leaves it undefined when none is sent.
    @Body() dto?: CallNextDto,
  ) {
    return this.queue.callNext(slug, counterId, dto);
  }

  @Post('tickets/:ticketId/start')
  @HttpCode(200)
  start(
    @Param('slug') slug: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.queue.transitionTicket(slug, ticketId, 'start');
  }

  @Post('tickets/:ticketId/complete')
  @HttpCode(200)
  complete(
    @Param('slug') slug: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.queue.transitionTicket(slug, ticketId, 'complete');
  }

  @Post('tickets/:ticketId/skip')
  @HttpCode(200)
  skip(
    @Param('slug') slug: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.queue.transitionTicket(slug, ticketId, 'skip');
  }
}

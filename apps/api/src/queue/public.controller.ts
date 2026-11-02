import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CreateTicketDto } from './dto.js';
import { QueueService } from './queue.service.js';

// Customer-facing endpoints: no login, addressed by tenant slug.
@Controller('tenants/:slug')
export class PublicController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  getTenant(@Param('slug') slug: string) {
    return this.queue.getTenantOverview(slug);
  }

  @Get('queue')
  getQueue(
    @Param('slug') slug: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.queue.getQueue(slug, branchId);
  }

  @Post('tickets')
  createTicket(@Param('slug') slug: string, @Body() dto: CreateTicketDto) {
    return this.queue.createTicket(slug, dto);
  }

  @Get('tickets/:ticketId')
  getTicket(
    @Param('slug') slug: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.queue.getTicket(slug, ticketId);
  }
}

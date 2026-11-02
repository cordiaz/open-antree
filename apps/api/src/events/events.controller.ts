import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { interval, map, merge } from 'rxjs';
import { QueueService } from '../queue/queue.service.js';
import { EventsService } from './events.service.js';

// Comment lines keep idle connections open through proxies.
const HEARTBEAT_MS = 25_000;

@Controller('tenants/:slug')
export class EventsController {
  constructor(
    private readonly queue: QueueService,
    private readonly events: EventsService,
  ) {}

  // Server-Sent Events stream of a tenant's queue changes. Public, like the
  // queue board: events contain no customer data.
  @Get('events')
  async stream(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Resolved before any bytes are written, so an unknown tenant is a plain 404.
    const tenant = await this.queue.getTenant(slug);

    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tell nginx-style proxies not to buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    // Browsers reconnect after this many ms if the connection drops.
    response.write('retry: 3000\n\n');

    const subscription = merge(
      this.events
        .stream(tenant.id)
        .pipe(
          map((event) => `event: queue\ndata: ${JSON.stringify(event)}\n\n`),
        ),
      interval(HEARTBEAT_MS).pipe(map(() => ': ping\n\n')),
    ).subscribe((chunk) => response.write(chunk));

    const untrack = this.events.trackConnection(() => {
      subscription.unsubscribe();
      response.end();
    });
    request.on('close', () => {
      subscription.unsubscribe();
      untrack();
    });
  }
}

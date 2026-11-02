import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { RedisService } from '../redis/redis.service.js';

// "Something changed" notifications. They carry ids only, never customer
// data, so the stream can be public; clients refetch what they display.
export type QueueEvent = {
  type:
    | 'ticket.created'
    | 'ticket.called'
    | 'ticket.updated'
    | 'config.updated'
    // Open staff pages refetch and notice ended sessions right away.
    | 'staff.updated';
  branchId?: string;
  ticketId?: string;
  at: string;
};

type Listener = (event: QueueEvent) => void;

// Events go through Redis pub/sub so every API instance sees every change,
// not just the instance that handled the request.
@Injectable()
export class EventsService
  implements BeforeApplicationShutdown, OnModuleDestroy
{
  private readonly logger = new Logger(EventsService.name);
  // A connection in subscriber mode can't run other commands, so it is
  // separate from the shared client. One per process, shared by all streams,
  // opened on first use.
  private subscriberConnection?: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();
  // Open client streams, closed on shutdown (see beforeApplicationShutdown).
  private readonly connections = new Set<() => void>();

  constructor(private readonly redis: RedisService) {}

  private get subscriber(): Redis {
    if (!this.subscriberConnection) {
      const connection = this.redis.client.duplicate();
      connection.on('error', (error: Error) => {
        this.logger.warn(`Redis subscriber error: ${error.message}`);
      });
      connection.on('message', (channel: string, message: string) => {
        const listeners = this.listeners.get(channel);
        if (!listeners) return;
        const event = JSON.parse(message) as QueueEvent;
        for (const listener of listeners) {
          listener(event);
        }
      });
      this.subscriberConnection = connection;
    }
    return this.subscriberConnection;
  }

  // Fire-and-forget: a Redis hiccup must not fail the request that changed
  // the queue; clients still catch up through their fallback polling.
  async publish(
    tenantId: string,
    event: Omit<QueueEvent, 'at'>,
  ): Promise<void> {
    try {
      await this.redis.client.publish(
        channel(tenantId),
        JSON.stringify({ ...event, at: new Date().toISOString() }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish ${event.type}: ${(error as Error).message}`,
      );
    }
  }

  // Emits every event of a tenant until unsubscribed. The Redis channel is
  // subscribed on the first listener and released after the last one leaves.
  stream(tenantId: string): Observable<QueueEvent> {
    const name = channel(tenantId);
    return new Observable<QueueEvent>((subscriber) => {
      const listener: Listener = (event) => subscriber.next(event);
      let listeners = this.listeners.get(name);
      if (!listeners) {
        listeners = new Set();
        this.listeners.set(name, listeners);
        this.subscriber.subscribe(name).catch((error: Error) => {
          this.logger.warn(`Could not subscribe to ${name}: ${error.message}`);
        });
      }
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(name);
          this.subscriber.unsubscribe(name).catch(() => undefined);
        }
      };
    });
  }

  // Registers an open client stream; returns a function to unregister it.
  trackConnection(close: () => void): () => void {
    this.connections.add(close);
    return () => this.connections.delete(close);
  }

  // The HTTP server waits for every connection to finish before the process
  // can exit, and event streams never finish on their own. End them so a
  // restart or deploy doesn't hang; browsers reconnect to the new process.
  beforeApplicationShutdown(): void {
    for (const close of this.connections) {
      close();
    }
    this.connections.clear();
  }

  onModuleDestroy(): void {
    this.subscriberConnection?.disconnect();
  }
}

function channel(tenantId: string): string {
  return `queue-events:${tenantId}`;
}

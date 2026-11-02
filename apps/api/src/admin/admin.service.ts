import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { SessionService } from '../auth/session.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  branches,
  counters,
  services,
  tickets,
  users,
} from '../database/schema.js';
import {
  CreateCounterDto,
  CreateServiceDto,
  CreateUserDto,
  UpdateCounterDto,
  UpdateServiceDto,
  UpdateUserDto,
} from './dto.js';

// Nothing here hard-deletes: services and counters are referenced by ticket
// history, so they are deactivated instead. Deactivated items disappear from
// the customer and operator pages.
//
// Every method receives the logged-in admin; all reads and writes are scoped
// to that admin's tenant (the guard already checked it matches the URL).
@Injectable()
export class AdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // Services

  listServices(admin: AuthUser) {
    return this.db
      .select(serviceColumns)
      .from(services)
      .where(eq(services.tenantId, admin.tenant.id))
      .orderBy(asc(services.ticketPrefix));
  }

  async createService(admin: AuthUser, dto: CreateServiceDto) {
    await this.assertBranch(admin, dto.branchId);
    const [service] = await uniqueOr409(
      this.db
        .insert(services)
        .values({
          tenantId: admin.tenant.id,
          branchId: dto.branchId,
          name: dto.name.trim(),
          ticketPrefix: dto.ticketPrefix,
          avgServiceMinutes: dto.avgServiceMinutes,
        })
        .returning(serviceColumns),
      `Prefix ${dto.ticketPrefix} sudah dipakai layanan lain di cabang ini`,
    );
    return service;
  }

  async updateService(admin: AuthUser, id: string, dto: UpdateServiceDto = {}) {
    const changes = requireChanges({
      name: dto.name?.trim(),
      ticketPrefix: dto.ticketPrefix,
      avgServiceMinutes: dto.avgServiceMinutes,
      isActive: dto.isActive,
    });
    const [service] = await uniqueOr409(
      this.db
        .update(services)
        .set(changes)
        .where(and(eq(services.id, id), eq(services.tenantId, admin.tenant.id)))
        .returning(serviceColumns),
      `Prefix ${dto.ticketPrefix} sudah dipakai layanan lain di cabang ini`,
    );
    if (!service) {
      throw new NotFoundException('Layanan tidak ditemukan');
    }
    return service;
  }

  // Counters

  listCounters(admin: AuthUser) {
    return this.db
      .select(counterColumns)
      .from(counters)
      .where(eq(counters.tenantId, admin.tenant.id))
      .orderBy(asc(counters.name));
  }

  async createCounter(admin: AuthUser, dto: CreateCounterDto) {
    await this.assertBranch(admin, dto.branchId);
    const name = dto.name.trim();
    const [counter] = await uniqueOr409(
      this.db
        .insert(counters)
        .values({ branchId: dto.branchId, name, tenantId: admin.tenant.id })
        .returning(counterColumns),
      `Loket bernama "${name}" sudah ada di cabang ini`,
    );
    return counter;
  }

  async updateCounter(admin: AuthUser, id: string, dto: UpdateCounterDto = {}) {
    if (dto.isActive === false) {
      // Don't strand a customer who has been called to this counter.
      const [active] = await this.db
        .select({ code: tickets.code })
        .from(tickets)
        .where(
          and(
            eq(tickets.counterId, id),
            eq(tickets.tenantId, admin.tenant.id),
            inArray(tickets.status, ['called', 'serving']),
          ),
        )
        .limit(1);
      if (active) {
        throw new ConflictException(
          `Loket masih menangani ${active.code}; selesaikan atau lewati dulu`,
        );
      }
    }

    const name = dto.name?.trim();
    const changes = requireChanges({ name, isActive: dto.isActive });
    const [counter] = await uniqueOr409(
      this.db
        .update(counters)
        .set(changes)
        .where(and(eq(counters.id, id), eq(counters.tenantId, admin.tenant.id)))
        .returning(counterColumns),
      `Loket bernama "${name}" sudah ada di cabang ini`,
    );
    if (!counter) {
      throw new NotFoundException('Loket tidak ditemukan');
    }
    return counter;
  }

  // Staff accounts

  listUsers(admin: AuthUser) {
    return this.db
      .select(userColumns)
      .from(users)
      .where(eq(users.tenantId, admin.tenant.id))
      .orderBy(asc(users.createdAt));
  }

  async createUser(admin: AuthUser, dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const [user] = await uniqueOr409(
      this.db
        .insert(users)
        .values({
          tenantId: admin.tenant.id,
          email,
          name: dto.name.trim(),
          role: dto.role,
          passwordHash: await hashPassword(dto.password),
        })
        .returning(userColumns),
      `${email} sudah punya akun`,
    );
    return user;
  }

  async updateUser(
    admin: AuthUser,
    id: string,
    dto: UpdateUserDto | undefined,
    currentToken: string | null,
  ) {
    dto ??= {};
    // An admin can't lock themselves out. Since the requester is an active
    // admin, this also guarantees the tenant always keeps one.
    if (
      id === admin.id &&
      (dto.isActive === false || dto.role === 'operator')
    ) {
      throw new BadRequestException(
        'Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri',
      );
    }

    const { password } = dto;
    const changes = requireChanges({
      name: dto.name?.trim(),
      role: dto.role,
      isActive: dto.isActive,
      passwordHash: password ? await hashPassword(password) : undefined,
    });
    const [user] = await this.db
      .update(users)
      .set(changes)
      .where(and(eq(users.id, id), eq(users.tenantId, admin.tenant.id)))
      .returning(userColumns);
    if (!user) {
      throw new NotFoundException('Akun tidak ditemukan');
    }

    if (password || dto.isActive === false) {
      // Keep the admin's own current session when they change their password.
      await this.sessions.destroyAllForUser(
        id,
        id === admin.id ? (currentToken ?? undefined) : undefined,
      );
    }
    return user;
  }

  private async assertBranch(admin: AuthUser, branchId: string) {
    const [branch] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, branchId), eq(branches.tenantId, admin.tenant.id)),
      );
    if (!branch) {
      throw new NotFoundException('Cabang tidak ditemukan');
    }
  }
}

const serviceColumns = {
  id: services.id,
  branchId: services.branchId,
  name: services.name,
  ticketPrefix: services.ticketPrefix,
  avgServiceMinutes: services.avgServiceMinutes,
  isActive: services.isActive,
};

const counterColumns = {
  id: counters.id,
  branchId: counters.branchId,
  name: counters.name,
  isActive: counters.isActive,
};

// Never includes passwordHash.
const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

// Rejects a PATCH that changes nothing (Drizzle can't run an empty UPDATE).
function requireChanges<T extends Record<string, unknown>>(changes: T): T {
  if (Object.values(changes).every((value) => value === undefined)) {
    throw new BadRequestException('Tidak ada perubahan');
  }
  return changes;
}

// Turns a unique-constraint violation (Postgres 23505) into a 409.
async function uniqueOr409<T>(query: Promise<T>, message: string): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
      throw new ConflictException(message);
    }
    throw error;
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, CurrentUser, Roles } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { readSessionCookie } from '../auth/cookie.js';
import { AdminService } from './admin.service.js';
import {
  CreateCounterDto,
  CreateServiceDto,
  CreateUserDto,
  UpdateCounterDto,
  UpdateServiceDto,
  UpdateUserDto,
} from './dto.js';

// Tenant configuration, admins only.
@Controller('tenants/:slug/admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('services')
  listServices(@CurrentUser() user: AuthUser) {
    return this.admin.listServices(user);
  }

  @Post('services')
  createService(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.admin.createService(user, dto);
  }

  @Patch('services/:id')
  updateService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.admin.updateService(user, id, dto);
  }

  @Get('counters')
  listCounters(@CurrentUser() user: AuthUser) {
    return this.admin.listCounters(user);
  }

  @Post('counters')
  createCounter(@CurrentUser() user: AuthUser, @Body() dto: CreateCounterDto) {
    return this.admin.createCounter(user, dto);
  }

  @Patch('counters/:id')
  updateCounter(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCounterDto,
  ) {
    return this.admin.updateCounter(user, id, dto);
  }

  @Get('users')
  listUsers(@CurrentUser() user: AuthUser) {
    return this.admin.listUsers(user);
  }

  @Post('users')
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    return this.admin.createUser(user, dto);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: Request,
  ) {
    return this.admin.updateUser(user, id, dto, readSessionCookie(request));
  }
}

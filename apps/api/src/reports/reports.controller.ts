import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { ReportQueryDto } from './dto.js';
import { ReportsService } from './reports.service.js';

@Controller('tenants/:slug/admin/reports')
@UseGuards(AuthGuard)
@Roles('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  getReport(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto) {
    return this.reports.getReport(user, query);
  }
}

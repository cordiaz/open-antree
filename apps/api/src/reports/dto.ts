import { IsOptional, IsUUID, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

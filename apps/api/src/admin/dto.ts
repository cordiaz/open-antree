import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const NOT_BLANK = /\S/;
const PREFIX = /^[A-Z]{1,4}$/;
const PREFIX_MESSAGE = 'ticketPrefix must be 1-4 capital letters, e.g. A';

export class CreateServiceDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(100)
  name: string;

  @Matches(PREFIX, { message: PREFIX_MESSAGE })
  ticketPrefix: string;

  @IsInt()
  @Min(1)
  @Max(480)
  avgServiceMinutes: number;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(100)
  name?: string;

  // Applies to new tickets; existing codes stay as issued.
  @IsOptional()
  @Matches(PREFIX, { message: PREFIX_MESSAGE })
  ticketPrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  avgServiceMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCounterDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(50)
  name: string;
}

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(100)
  name: string;

  @IsIn(['admin', 'operator'])
  role: 'admin' | 'operator';

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be empty' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['admin', 'operator'])
  role?: 'admin' | 'operator';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Setting a new password ends the user's other sessions.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;
}

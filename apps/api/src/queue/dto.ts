import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTicketDto {
  @IsUUID()
  serviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  // Digits with an optional leading +, e.g. 081234567890 or +6281234567890.
  @IsOptional()
  @Matches(/^\+?[0-9]{8,15}$/, {
    message: 'customerPhone must be 8-15 digits, optionally starting with +',
  })
  customerPhone?: string;
}

export class CallNextDto {
  // Limit the call to one service; otherwise the oldest waiting ticket of the branch.
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

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

  // WhatsApp number for notifications, e.g. 0812-3456-7890 or +6281234567890;
  // normalised by the service.
  @IsOptional()
  @Matches(/^\+?[0-9 ().-]{8,24}$/, {
    message: 'Nomor WhatsApp tidak valid',
  })
  customerPhone?: string;
}

export class CallNextDto {
  // Limit the call to one service; otherwise the oldest waiting ticket of the branch.
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

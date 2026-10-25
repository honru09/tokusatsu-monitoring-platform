import { Type } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class PushSubscriptionKeysDto {
  @IsString()
  @MaxLength(512)
  p256dh!: string;

  @IsString()
  @MaxLength(512)
  auth!: string;
}

export class PushSubscriptionPayloadDto {
  @IsString()
  @MaxLength(4096)
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class SubscribePushDto {
  @IsString()
  accountId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionPayloadDto)
  subscription!: PushSubscriptionPayloadDto;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class UnsubscribePushDto {
  @IsString()
  accountId!: string;

  @IsString()
  @MaxLength(4096)
  endpoint!: string;
}

import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
export class ResaleActorDto {
  @IsString() @Length(1, 120) accountId!: string;
}
export class ResaleVersionDto extends ResaleActorDto {
  @IsInt() @Min(1) version!: number;
}
export class ResaleQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional()
  @IsIn([
    "draft",
    "ready",
    "queued",
    "publishing",
    "published",
    "paused",
    "blocked",
    "uncertain",
    "withdrawing",
    "withdrawn",
  ])
  status?: string;
}
export class ImportResaleDto extends ResaleActorDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  itemIds?: string[];
}
export class UpdateResaleDto extends ResaleVersionDto {
  @Transform(trim) @IsString() @Length(1, 60) title!: string;
  @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  priceCny!: number;
  @IsArray()
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsString({ each: true })
  imageUrls!: string[];
  @Transform(trim) @IsString() @MaxLength(2000) deliveryText!: string;
  @IsOptional() @IsIn(["free", "fixed", "distance", "none"]) shippingMode?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) shippingFeeCny?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) locationText?: string;
  @IsBoolean() rightsConfirmed!: boolean;
  @IsBoolean() fulfillmentConfirmed!: boolean;
}
export class ResaleActionDto extends ResaleVersionDto {
  @IsIn([
    "takeover",
    "resume",
    "pause",
    "approve",
    "enqueue",
    "publish",
    "generate",
    "recheck",
    "record",
    "withdraw",
    "confirm_withdrawn",
    "confirm_not_published",
  ])
  action!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  targetItemId?: string;
  @IsOptional() @IsString() @MaxLength(1000) targetUrl?: string;
  @IsOptional() @IsISO8601() publishAt?: string;
}
export class UpdateResaleSettingsDto extends ResaleActorDto {
  @IsBoolean() paused!: boolean;
  @IsBoolean() autoImport!: boolean;
  @IsBoolean() autoGenerate!: boolean;
  @IsBoolean() autoPublish!: boolean;
  @IsOptional() @IsBoolean() autoMetrics?: boolean;
  @IsInt() @Min(1) @Max(1000) dailyPublishLimit!: number;
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 160, { each: true })
  keywords!: string[];
  @IsInt() @Min(0) @Max(100000000) minPriceJpy!: number;
  @IsInt() @Min(1) @Max(100000000) maxPriceJpy!: number;
  @IsNumber() @Min(0.001) @Max(1) exchangeRate!: number;
  @IsNumber() @Min(0) @Max(1000) markupPercent!: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  extraCostCny!: number;
  @IsInt() @Min(1) @Max(120) sourceFreshMinutes!: number;
  @IsString() @MaxLength(2000) deliveryText!: string;
  @IsOptional() @IsIn(["free", "fixed", "distance", "none"]) shippingMode?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) shippingFeeCny?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) locationText?: string;
  @IsOptional()
  @IsIn(["value", "professional", "popular", "practical", "premium", "local"])
  titleStyle?: string;
  @IsOptional() @IsInt() @Min(15) @Max(60) titleMaxLength?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  excludedKeywords?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  requiredKeywords?: string[];
}

export class ResaleBulkDto extends ResaleActorDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 120, { each: true })
  listingIds!: string[];
  @IsIn(["generate", "approve", "enqueue", "pause", "recheck", "takeover"])
  action!: string;
  @IsObject() versions!: Record<string, number>;
  @IsOptional() @IsISO8601() publishAt?: string;
}
export class ResaleMonitorDto extends ResaleActorDto {
  @IsOptional() @IsString() @Length(1, 120) id?: string;
  @Transform(trim) @IsString() @Length(1, 100) keyword!: string;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  minPriceCny!: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  maxPriceCny!: number;
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  excludedKeywords!: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  requiredKeywords!: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  regions!: string[];
  @IsInt() @Min(30) @Max(1440) intervalMinutes!: number;
  @IsBoolean() active!: boolean;
}
export class ResaleObservationDto extends ResaleActorDto {
  @IsArray() @ArrayMaxSize(100) items!: Record<string, unknown>[];
}
export class ResaleMetricDto extends ResaleActorDto {
  @IsString() @Length(1, 120) listingId!: string;
  @IsISO8601() observedAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) views?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) wants?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) orders?: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000000)
  revenueCny?: number;
}
export class ResaleMetricsQueryDto {
  @Type(() => Number) @IsIn([7, 14, 30]) days = 7;
}
export class ResaleMetricSyncDto extends ResaleActorDto {
  @IsString() @Length(1, 120) listingId!: string;
}
export class ResaleTaskDto extends ResaleVersionDto {
  @IsString() @Length(1, 120) listingId!: string;
  @IsIn(["bump", "reprice"]) kind!: "bump" | "reprice";
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  priceCny?: number;
  @IsISO8601() scheduledAt!: string;
}
export class ResaleTaskResultDto extends ResaleActorDto {
  @IsIn(["cancel", "confirmed", "not_executed"]) action!:
    | "cancel"
    | "confirmed"
    | "not_executed";
}

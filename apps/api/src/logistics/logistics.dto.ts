import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from "class-validator";

const basisValues = ["weight", "volume"] as const;

export class LogisticsPatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  weightGrams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  packageWeightGrams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5_000)
  lengthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5_000)
  widthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5_000)
  heightMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  volumeCm3?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  estimatedSalePriceYen?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  estimatedProfitYen?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class OptimizeLogisticsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsUUID("4", { each: true })
  itemIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zone?: string;

  @IsOptional()
  @IsBoolean()
  withAi?: boolean;

  @IsOptional()
  @IsUUID("4")
  carrierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  shippingFeeYen?: number;
}

export class CreateCarrierDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateCarrierDto extends CreateCarrierDto {}

export class CreateTariffDto {
  @IsString()
  @MaxLength(120)
  serviceName!: string;

  @IsIn(basisValues)
  basis!: (typeof basisValues)[number];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  minValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  maxValue?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceYen!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceNote?: string;
}

export class UpdateTariffDto extends CreateTariffDto {}

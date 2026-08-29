import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import {
  categoryIps,
  conditionGrades,
  manufacturers,
  toyTypes,
} from "@tokusatsu/shared";

const optionalBoolean = ({ value }: { value: unknown }) =>
  value === true || value === "true";

export class ListItemsQuery {
  @IsOptional() @IsIn(categoryIps) ip?: string;
  @IsOptional() @IsIn(conditionGrades) condition?: string;
  @IsOptional() @IsIn(toyTypes) toyType?: string;
  @IsOptional() @IsIn(manufacturers) manufacturer?: string;
  @IsOptional() @IsIn(["online", "physical_store"]) channel?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsIn(["search", "url"]) importOrigin?: string;
  @IsOptional()
  @IsIn(["lt_1000", "1000_2999", "3000_4999", "gte_5000"])
  priceBand?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minQuantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxUnitCost?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  auctionHours?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  listedWithinHours?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  detectedWithinHours?: number;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Transform(optionalBoolean) @IsBoolean() needsReview?: boolean;
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  includeIgnored?: boolean;
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  favorite?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

export class UpdateItemDto {
  @IsOptional() @IsIn(categoryIps) categoryIp?: string;
  @IsOptional() @IsIn(conditionGrades) conditionGrade?: string;
  @IsOptional() @IsIn(toyTypes) categoryToyType?: string;
  @IsOptional() @IsIn(manufacturers) manufacturer?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantityEst?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1)
  confidence?: number;
  @IsOptional() @IsBoolean() favorite?: boolean;
  @IsOptional() @IsBoolean() ignored?: boolean;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() actor?: string;
}

export class AnalyzeUrlDto {
  @IsString()
  url!: string;
}

export class PurchaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  purchaseAmount!: number;

  @IsOptional() @IsString() purchasedAt?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() receiptFileName?: string;
  @IsOptional() @IsString() receiptMimeType?: string;
  @IsOptional() @IsString() @Length(1, 7_000_000) receiptDataBase64?: string;
}

import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ListInventoryOrdersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class CreateInventoryOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  purchaseCost!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  initialQuantity!: number;

  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(80) platform?: string;
  @IsOptional() @IsString() purchasedAt?: string;
  @IsOptional() @IsString() @MaxLength(2_000) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class SellInventoryOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  /** Total sale price for this sale (bulk sell uses one total). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  salePrice!: number;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AdjustInventoryOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  quantityDelta!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

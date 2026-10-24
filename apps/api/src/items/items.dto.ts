import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  categoryIps,
  collectibleSeriesKeys,
  conditionGrades,
  manufacturers,
  shfEditions,
  shfLines,
  shfRegions,
  shfReleaseChannels,
  toyTypes,
} from "@tokusatsu/shared";
import { sellerSegmentKeys } from "./seller-segments.js";
import { type XianyuPriceBand, xianyuPriceBands } from "./item-response.js";

const optionalBoolean = ({ value }: { value: unknown }) =>
  value === true || value === "true";

export class ListItemsQuery {
  @IsOptional() @IsString() @Length(1, 128) monitoringCategoryId?: string;
  @IsOptional() @IsIn(categoryIps) ip?: string;
  @IsOptional()
  @IsIn(collectibleSeriesKeys)
  collection?: (typeof collectibleSeriesKeys)[number];
  @IsOptional() @IsIn(shfLines) shfLine?: string;
  @IsOptional() @IsIn(shfReleaseChannels) shfReleaseChannel?: string;
  @IsOptional() @IsIn(shfEditions) shfEdition?: string;
  @IsOptional() @IsIn(shfRegions) shfRegion?: string;
  @IsOptional() @IsIn(conditionGrades) condition?: string;
  @IsOptional() @IsIn(toyTypes) toyType?: string;
  @IsOptional() @IsIn(manufacturers) manufacturer?: string;
  @IsOptional() @IsIn(["online", "physical_store"]) channel?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsIn(["search", "url"]) importOrigin?: string;
  @IsOptional()
  @IsIn(["auction", "direct", "unknown"])
  listingType?: string;
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
  @Max(10_080)
  auctionMinutes?: number;
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
  ignored?: boolean;
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  favorite?: boolean;
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  hasXianyuComparison?: boolean;
  @IsOptional()
  @Transform(optionalBoolean)
  @IsBoolean()
  valueKing?: boolean;
  @IsOptional()
  @IsIn(xianyuPriceBands)
  xianyuPriceBand?: XianyuPriceBand;
  @IsOptional()
  @IsIn(["price", "auctionEndAt", "xianyuPrice"])
  sortBy?: "price" | "auctionEndAt" | "xianyuPrice";
  @IsOptional() @IsIn(["asc", "desc"]) sortOrder?: "asc" | "desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

export class ItemChangesQuery {
  @IsOptional()
  @IsString()
  since?: string;
}

export class ListSellersQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(sellerSegmentKeys) segment?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 60;
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
  @IsOptional() @IsString() @MaxLength(25) note?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() actor?: string;
}

export class DeleteItemDto {
  @IsOptional() @IsString() @Length(1, 120) actor?: string;
}

export class AnalyzeUrlDto {
  @IsOptional() @IsString() @MaxLength(20_000) url?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(4_096, { each: true })
  urls?: string[];
}

export class PurchaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  purchaseAmount!: number;

  // Operator-confirmed unit count. Stored as PurchaseRecord.quantityOverride
  // and preferred over the recognised quantityEst in inventory math.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;

  @IsOptional() @IsString() purchasedAt?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() receiptFileName?: string;
  @IsOptional() @IsString() receiptMimeType?: string;
  @IsOptional()
  @IsString()
  @Length(1, 4_194_304)
  receiptDataBase64?: string;

  @IsOptional() @IsString() @Length(1, 120) actor?: string;
  @IsOptional() @IsString() @Length(1, 1000) reason?: string;
}

export const purchasePricingModes = ["per_item", "bundle_total"] as const;
export type PurchasePricingMode = (typeof purchasePricingModes)[number];

export class AnalyzePurchaseLinksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(4_096, { each: true })
  urls!: string[];

  // Optional actual paid price per URL, keyed by the URL as submitted.
  // Values are checked again in the service: only positive integers
  // up to 100,000,000 are carried into the analysis job.
  @IsOptional()
  @IsObject()
  amountsByUrl?: Record<string, number>;
}

export class PurchaseBundleMemberDto {
  @IsString() @Length(1, 200) itemId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  amountYen?: number;

  // Operator-confirmed unit count for this member. Stored as
  // PurchaseRecord.quantityOverride; omit to keep the recognised estimate.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;
}

export class CreatePurchaseBundleDto {
  @IsIn(purchasePricingModes)
  pricingMode!: PurchasePricingMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseBundleMemberDto)
  members!: PurchaseBundleMemberDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalPurchaseAmountYen?: number;

  @IsOptional() @IsString() purchasedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsString() @Length(1, 120) actor!: string;
  @IsString() @Length(1, 1000) reason!: string;
}

export class UpdatePurchaseBundleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional() @IsIn(purchasePricingModes) pricingMode?: PurchasePricingMode;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseBundleMemberDto)
  members?: PurchaseBundleMemberDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalPurchaseAmountYen?: number;

  @IsOptional() @IsString() purchasedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsString() @Length(1, 120) actor!: string;
  @IsString() @Length(1, 1000) reason!: string;
}

export class ListPurchaseBundlesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}

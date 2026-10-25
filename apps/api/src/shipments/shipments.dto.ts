import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class ShipmentLineDto {
  @IsString()
  inventoryOrderId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitDeclaredYen!: number;
}

export class CreateShipmentDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(1)
  exchangeRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalDeclaredCny?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  lines!: ShipmentLineDto[];
}

export class ListShipmentsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

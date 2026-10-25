import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  lines!: ShipmentLineDto[];
}

export class ListShipmentsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

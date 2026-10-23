import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from "class-validator";

export class UpdateCartItemDto {
  @IsBoolean()
  present!: boolean;
}

export class CreateCartShareDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  accountId?: string;
}

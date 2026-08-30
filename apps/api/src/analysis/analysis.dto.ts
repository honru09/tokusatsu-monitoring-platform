import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

export class TranslateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  // Product descriptions can be long. Keep the complete public text for AI
  // translation instead of silently truncating it at a keyword-sized limit.
  @Length(1, 12_000, { each: true })
  texts!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsUUID("4", { each: true })
  itemIds?: string[];
}

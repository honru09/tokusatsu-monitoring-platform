import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Length,
} from "class-validator";

export class TranslateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  @Length(1, 4_000, { each: true })
  texts!: string[];
}

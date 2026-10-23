import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class MonitoringActorDto {
  @IsString() @Length(1, 120) accountId!: string;
}

export class CreateMonitoringCategoryDto extends MonitoringActorDto {
  @Transform(trimmed) @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @Length(1, 120) parentId?: string | null;
  @IsOptional() @IsIn(["toys", "general"]) scope?: "toys" | "general";
}

export class UpdateMonitoringCategoryDto extends MonitoringActorDto {
  @IsOptional() @Transform(trimmed) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(1, 120) parentId?: string | null;
  @IsOptional() @IsIn(["toys", "general"]) scope?: "toys" | "general";
}

export class CreateMonitoringKeywordDto extends MonitoringActorDto {
  @Transform(trimmed) @IsString() @Length(1, 160) keyword!: string;
  @IsString() @Length(1, 120) categoryId!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  intervalMinutes?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  sourceKeys?: string[];
}

export class UpdateMonitoringKeywordDto extends MonitoringActorDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 160)
  keyword?: string;
  @IsOptional() @IsString() @Length(1, 120) categoryId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  intervalMinutes?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  sourceKeys?: string[];
}

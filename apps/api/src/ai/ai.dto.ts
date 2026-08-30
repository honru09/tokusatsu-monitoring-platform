import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { AiTask } from "./ai-router.js";

export class ImageAnalysisDto {
  @IsString()
  @Length(1, 500)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 12_000)
  description?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUrl({ require_protocol: true }, { each: true })
  imageUrls!: string[];
}

export class AiFeedbackDto {
  @IsIn(["correct", "incorrect", "interested", "purchased", "not_worth_buying"])
  action!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class DiagnosisDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  source?: string;
}

export class AssistantChatMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @Length(1, 6_000)
  content!: string;
}

export class AssistantChatDto {
  @IsString()
  @Length(1, 2_000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantChatMessageDto)
  history?: AssistantChatMessageDto[];
}

export class InternalExecuteDto {
  @IsIn([
    "bulk_filter",
    "translation",
    "classification",
    "image_analysis",
    "seller_analysis",
    "complex_analysis",
    "cross_validation",
    "market_analysis",
    "crawler_diagnosis",
    "logistics_analysis",
    "assistant_chat",
  ])
  task!: AiTask;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  messages!: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;

  @IsInt()
  maxTokens!: number;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUrl({ require_protocol: true }, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  bypassCache?: boolean;
}

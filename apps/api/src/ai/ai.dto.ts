import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { AiTask } from "./ai-router.js";
import {
  PRODUCT_AI_OPERATIONS,
  type ProductAiOperation,
} from "./product-ai.service.js";
import {
  INTERNAL_RESPONSE_SCHEMA_IDS,
  type InternalResponseSchemaId,
} from "./ai-internal-response-contracts.js";

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
  @IsUrl(
    {
      protocols: ["https"],
      require_protocol: true,
      require_valid_protocol: true,
    },
    { each: true },
  )
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

export class InternalAiMessageDto {
  @IsIn(["system", "user", "assistant"])
  role!: "system" | "user" | "assistant";

  @IsString()
  @Length(1, 50_000)
  content!: string;
}

export class InternalExecuteDto {
  @IsIn([...INTERNAL_RESPONSE_SCHEMA_IDS])
  responseSchemaId!: InternalResponseSchemaId;

  @IsInt()
  @Min(1)
  @Max(999_999)
  responseSchemaVersion!: number;

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

  @IsOptional()
  @IsIn(["public_market", "user_private", "sensitive_image"])
  dataClass?: "public_market" | "user_private" | "sensitive_image";

  @IsOptional()
  @IsIn(["free_only", "free_first", "paid_allowed"])
  costPolicy?: "free_only" | "free_first" | "paid_allowed";

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InternalAiMessageDto)
  messages!: InternalAiMessageDto[];

  @IsInt()
  @Min(8)
  @Max(20_000)
  maxTokens!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUrl(
    {
      protocols: ["https"],
      require_protocol: true,
      require_valid_protocol: true,
    },
    { each: true },
  )
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 200)
  itemId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  sellerId?: string;

  @IsOptional()
  @IsBoolean()
  bypassCache?: boolean;
}

export class InternalProductExecuteDto {
  @IsIn([...INTERNAL_RESPONSE_SCHEMA_IDS])
  responseSchemaId!: InternalResponseSchemaId;

  @IsInt()
  @Min(1)
  @Max(999_999)
  responseSchemaVersion!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  expectedIds?: string[];

  @IsIn(PRODUCT_AI_OPERATIONS)
  operation!: ProductAiOperation;

  @IsOptional()
  @IsIn(["public_market", "user_private", "sensitive_image"])
  dataClass?: "public_market" | "user_private" | "sensitive_image";

  @IsOptional()
  @IsIn(["free_only", "free_first", "paid_allowed"])
  costPolicy?: "free_only" | "free_first" | "paid_allowed";

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InternalAiMessageDto)
  messages!: InternalAiMessageDto[];

  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(20_000)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUrl(
    {
      protocols: ["https"],
      require_protocol: true,
      require_valid_protocol: true,
    },
    { each: true },
  )
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 200)
  itemId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  sellerId?: string;

  @IsOptional()
  @IsBoolean()
  bypassCache?: boolean;
}

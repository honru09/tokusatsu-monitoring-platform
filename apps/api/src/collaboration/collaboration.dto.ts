import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class SendDirectMessageDto {
  @IsString()
  senderId!: string;

  @IsString()
  recipientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  text?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  targetPriceYen?: number;

  @IsOptional()
  @IsObject()
  itemTargets?: Record<string, number>;

  @IsOptional()
  @IsString()
  replyToId?: string;

  @IsOptional()
  @IsString()
  forwardedFromId?: string;
}

export class MarkDirectMessagesReadDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  messageIds?: string[];
}

export class MessageReactionDto {
  @IsString()
  accountId!: string;

  @IsString()
  @IsIn([
    "heart",
    "agree",
    "check",
    "knife",
    "like",
    "negotiation_success",
    "negotiation_failed",
  ])
  reaction!:
    | "heart"
    | "agree"
    | "check"
    | "knife"
    | "like"
    | "negotiation_success"
    | "negotiation_failed";
}

export class ManagerPresenceDto {
  @IsString()
  accountId!: string;
}

export class StartNegotiationsDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];
}

export class UpdateNegotiationDto {
  @IsString()
  accountId!: string;

  @IsString()
  @IsIn(["in_progress", "success", "failed"])
  status!: "in_progress" | "success" | "failed";
}

export class ClearFailedNegotiationsDto {
  @IsString()
  accountId!: string;
}

export class SetItemDecisionDto {
  @IsString()
  accountId!: string;

  @IsString()
  itemId!: string;

  @IsString()
  @IsIn(["want", "negotiate", "pass", "bought"])
  status!: "want" | "negotiate" | "pass" | "bought";

  @IsOptional()
  @IsString()
  roundId?: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

export class ShareRoundItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetPriceYen?: number;
}

export class CreateShareRoundDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShareRoundItemDto)
  items!: ShareRoundItemDto[];
}

export class AnalyzeSelectionItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsString()
  roundId?: string | null;
}

export class AnalyzeSelectionDto {
  // Present so the session guard can overwrite it with the token identity;
  // the analysis itself does not depend on who asks.
  @IsString()
  accountId!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnalyzeSelectionItemDto)
  items!: AnalyzeSelectionItemDto[];
}

export class MarkShareRoundCopiedDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];
}

export class UpdateShareRoundItemDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsBoolean()
  copied?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetPriceYen?: number | null;
}

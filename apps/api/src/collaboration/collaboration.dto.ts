import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
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

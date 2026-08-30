import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class DiscoveryFeedQuery {
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(50)
  limit = 12;

  @IsOptional()
  @IsIn(["auction", "direct"])
  listingType?: "auction" | "direct";
}

export class DiscoveryFeedbackDto {
  @IsUUID()
  listingId!: string;

  @IsIn(["dislike", "favorite", "detail_view"])
  action!: "dislike" | "favorite" | "detail_view";

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position!: number;
}

export class DiscoveryUndoDto {
  @IsString()
  @IsUUID()
  feedbackId!: string;
}

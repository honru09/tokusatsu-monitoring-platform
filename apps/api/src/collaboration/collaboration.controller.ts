import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ClearFailedNegotiationsDto,
  CreateShareRoundDto,
  MarkDirectMessagesReadDto,
  ManagerPresenceDto,
  MessageReactionDto,
  SendDirectMessageDto,
  SetItemDecisionDto,
  StartNegotiationsDto,
  UpdateNegotiationDto,
  UpdateShareRoundItemDto,
} from "./collaboration.dto.js";
import { CollaborationService } from "./collaboration.service.js";
import { NegotiationScriptService } from "./negotiation-script.service.js";

@Controller("collaboration")
export class CollaborationController {
  constructor(
    private readonly collaboration: CollaborationService,
    private readonly negotiationScript: NegotiationScriptService,
  ) {}

  @Post("share-rounds/:id/negotiation-script")
  shareRoundNegotiationScript(@Param("id") id: string) {
    return this.negotiationScript.negotiationScript(id);
  }

  @Get("accounts")
  accounts(@Query("accountId") accountId?: string) {
    return this.collaboration.accounts(accountId);
  }

  @Post("presence")
  presence(@Body() body: ManagerPresenceDto) {
    return this.collaboration.presence(body.accountId);
  }

  @Get("messages")
  messages(
    @Query("accountId") accountId: string,
    @Query("after") after?: string,
  ) {
    return this.collaboration.messages(accountId, after);
  }

  @Post("messages")
  send(@Body() body: SendDirectMessageDto) {
    return this.collaboration.send(body);
  }

  @Post("messages/read")
  markRead(@Body() body: MarkDirectMessagesReadDto) {
    return this.collaboration.markRead(body);
  }

  @Post("messages/:messageId/reactions")
  addReaction(
    @Param("messageId") messageId: string,
    @Body() body: MessageReactionDto,
  ) {
    return this.collaboration.addReaction(messageId, body);
  }

  @Delete("messages/:messageId/reactions")
  removeReaction(
    @Param("messageId") messageId: string,
    @Body() body: MessageReactionDto,
  ) {
    return this.collaboration.removeReaction(messageId, body);
  }

  @Post("share-rounds")
  createShareRound(@Body() body: CreateShareRoundDto) {
    return this.collaboration.createShareRound(body);
  }

  @Get("share-rounds")
  shareRounds(@Query("accountId") accountId: string) {
    return this.collaboration.shareRounds(accountId);
  }

  @Get("share-rounds/:roundId")
  shareRound(
    @Param("roundId") roundId: string,
    @Query("accountId") accountId: string,
  ) {
    return this.collaboration.shareRound(accountId, roundId);
  }

  @Patch("share-rounds/:roundId/items/:itemId")
  updateShareRoundItem(
    @Param("roundId") roundId: string,
    @Param("itemId") itemId: string,
    @Body() body: UpdateShareRoundItemDto,
  ) {
    return this.collaboration.updateShareRoundItem(roundId, itemId, body);
  }

  @Get("decisions")
  decisions(@Query("accountId") accountId: string) {
    return this.collaboration.decisions(accountId);
  }

  @Post("decisions")
  setDecision(@Body() body: SetItemDecisionDto) {
    return this.collaboration.setDecision(body);
  }

  @Get("negotiations")
  negotiations(@Query("accountId") accountId: string) {
    return this.collaboration.negotiations(accountId);
  }

  @Post("negotiations/from-cart")
  startNegotiations(@Body() body: StartNegotiationsDto) {
    return this.collaboration.startNegotiations(body);
  }

  @Post("negotiations/failed/dislike")
  clearFailedNegotiations(@Body() body: ClearFailedNegotiationsDto) {
    return this.collaboration.clearFailedNegotiations(body.accountId);
  }

  @Post("negotiations/:caseId/status")
  updateNegotiation(
    @Param("caseId") caseId: string,
    @Body() body: UpdateNegotiationDto,
  ) {
    return this.collaboration.updateNegotiation(caseId, body);
  }
}

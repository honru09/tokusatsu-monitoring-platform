import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ClearFailedNegotiationsDto,
  MarkDirectMessagesReadDto,
  ManagerPresenceDto,
  MessageReactionDto,
  SendDirectMessageDto,
  StartNegotiationsDto,
  UpdateNegotiationDto,
} from "./collaboration.dto.js";
import { CollaborationService } from "./collaboration.service.js";

@Controller("collaboration")
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

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

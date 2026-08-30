import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { AiGatewayService } from "./ai-gateway.service.js";
import {
  AiFeedbackDto,
  AssistantChatDto,
  DiagnosisDto,
  ImageAnalysisDto,
  InternalExecuteDto,
} from "./ai.dto.js";
import { AiSystemService } from "./ai-system.service.js";
import { PublicAiAccess } from "./public-ai-access.guard.js";

@Controller("ai")
export class AiController {
  constructor(
    private readonly system: AiSystemService,
    private readonly gateway: AiGatewayService,
  ) {}

  @Get("system")
  overview() {
    return this.system.overview();
  }

  @Post("image-analysis")
  analyzeImages(
    @Headers("x-ai-internal-token") token: string | undefined,
    @Body() body: ImageAnalysisDto,
    @Query("itemId") itemId?: string,
  ) {
    this.assertInternalToken(token);
    return this.system.analyzeImages(body, itemId);
  }

  @Post("feedback/:itemId")
  feedback(@Param("itemId") itemId: string, @Body() body: AiFeedbackDto) {
    return this.system.feedback(itemId, body);
  }

  @Get("market-memory/:productId")
  productMemory(@Param("productId") productId: string) {
    return this.system.productMemory(productId);
  }

  @Post("system/diagnose")
  @HttpCode(200)
  @PublicAiAccess("diagnose")
  diagnose(@Body() body: DiagnosisDto) {
    return this.system.diagnose(body.source);
  }

  @Post("chat")
  @HttpCode(200)
  @PublicAiAccess("chat")
  chat(@Body() body: AssistantChatDto) {
    return this.system.chat(body);
  }

  @Post("internal/execute")
  executeInternal(
    @Headers("x-ai-internal-token") token: string | undefined,
    @Body() body: InternalExecuteDto,
  ) {
    this.assertInternalToken(token);
    return this.gateway.executeJson(body);
  }

  @Post("internal/refresh-memory")
  refreshMemory(@Headers("x-ai-internal-token") token: string | undefined) {
    this.assertInternalToken(token);
    return this.system.refreshOperationalMemory();
  }

  private assertInternalToken(token?: string) {
    const expected = process.env.AI_INTERNAL_TOKEN?.trim();
    if (!expected || !token || token !== expected)
      throw new ForbiddenException("Invalid AI internal token");
  }
}

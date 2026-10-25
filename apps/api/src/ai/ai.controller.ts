import { timingSafeEqual } from "node:crypto";
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
  ImageAnalysisDto,
  InternalExecuteDto,
  InternalProductExecuteDto,
} from "./ai.dto.js";
import { AiSystemService } from "./ai-system.service.js";
import { ProductAiService } from "./product-ai.service.js";
import { PublicAiAccess } from "./public-ai-access.guard.js";
import {
  internalGatewayResponseSchema,
  internalProductResponseSchema,
} from "./ai-internal-response-contracts.js";

@Controller("ai")
export class AiController {
  constructor(
    private readonly system: AiSystemService,
    private readonly gateway: AiGatewayService,
    private readonly productAi: ProductAiService,
  ) {}

  @Get("resources")
  resources() { return this.gateway.resourceStatus(); }

  @Post("items/:id/read")
  @HttpCode(200)
  @PublicAiAccess("reading")
  readItem(@Param("id") id: string) { return this.system.readItem(id); }

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
    const {
      responseSchemaId,
      responseSchemaVersion,
      responseSchema: _clientSchema,
      responseContract: _legacyContract,
      ...request
    } = body as InternalExecuteDto & {
      responseSchema?: unknown;
      responseContract?: unknown;
    };
    return this.gateway.executeJson({
      ...request,
      responseSchema: internalGatewayResponseSchema(
        request.task,
        responseSchemaId,
        responseSchemaVersion,
      ),
    });
  }

  @Post("internal/product/execute")
  executeProductInternal(
    @Headers("x-ai-internal-token") token: string | undefined,
    @Body() body: InternalProductExecuteDto,
  ) {
    this.assertInternalToken(token);
    const {
      operation,
      responseSchemaId,
      responseSchemaVersion,
      expectedIds,
      responseSchema: _clientSchema,
      responseContract: _legacyContract,
      ...input
    } = body as InternalProductExecuteDto & {
      responseSchema?: unknown;
      responseContract?: unknown;
    };
    return this.productAi.execute(operation, {
      ...input,
      responseSchema: internalProductResponseSchema(
        operation,
        responseSchemaId,
        responseSchemaVersion,
        expectedIds,
      ),
    });
  }

  @Post("internal/refresh-memory")
  refreshMemory(@Headers("x-ai-internal-token") token: string | undefined) {
    this.assertInternalToken(token);
    return this.system.refreshOperationalMemory();
  }

  private assertInternalToken(token?: string) {
    const expected = process.env.AI_INTERNAL_TOKEN?.trim();
    const expectedBytes = expected ? Buffer.from(expected) : undefined;
    const actualBytes = token ? Buffer.from(token) : undefined;
    if (
      !expectedBytes ||
      !actualBytes ||
      expectedBytes.length !== actualBytes.length ||
      !timingSafeEqual(expectedBytes, actualBytes)
    )
      throw new ForbiddenException("Invalid AI internal token");
  }
}

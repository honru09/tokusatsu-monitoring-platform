import { ValidationPipe } from "@nestjs/common";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import {
  ImageAnalysisDto,
  InternalExecuteDto,
  InternalProductExecuteDto,
} from "./ai.dto.js";

function imageErrors(errors: Awaited<ReturnType<typeof validate>>) {
  return errors.find((error) => error.property === "imageUrls")?.constraints;
}

describe("AI image URL DTO validation", () => {
  it.each([
    Object.assign(new ImageAnalysisDto(), {
      title: "item",
      imageUrls: ["http://images.example.test/item.jpg"],
    }),
    Object.assign(new InternalExecuteDto(), {
      task: "image_analysis",
      messages: [{ role: "user", content: "inspect" }],
      maxTokens: 64,
      imageUrls: ["http://images.example.test/item.jpg"],
    }),
    Object.assign(new InternalProductExecuteDto(), {
      operation: "image_analysis",
      messages: [{ role: "user", content: "inspect" }],
      imageUrls: ["http://images.example.test/item.jpg"],
    }),
  ])("rejects HTTP image URLs at the request boundary", async (dto) => {
    expect(imageErrors(await validate(dto))).toBeDefined();
  });

  it("accepts an HTTPS image URL at the request boundary", async () => {
    const dto = Object.assign(new ImageAnalysisDto(), {
      title: "item",
      imageUrls: ["https://images.example.test/item.jpg"],
    });

    expect(imageErrors(await validate(dto))).toBeUndefined();
  });
});

describe("internal AI response schema DTO validation", () => {
  const gatewayRequest = {
    task: "translation" as const,
    messages: [{ role: "user" as const, content: "translate" }],
    maxTokens: 64,
  };

  it("requires the schema ID and version instead of the legacy contract field", async () => {
    const dto = Object.assign(new InternalExecuteDto(), gatewayRequest, {
      responseContract: "market_intel_translation",
    });

    const properties = (await validate(dto)).map((error) => error.property);
    expect(properties).toEqual(
      expect.arrayContaining(["responseSchemaId", "responseSchemaVersion"]),
    );
  });

  it("rejects schema IDs outside the server whitelist", async () => {
    const dto = Object.assign(new InternalExecuteDto(), gatewayRequest, {
      responseSchemaId: "client.owned-schema",
      responseSchemaVersion: 1,
    });

    expect(
      (await validate(dto)).find(
        (error) => error.property === "responseSchemaId",
      ),
    ).toBeDefined();
  });

  it("strips client-owned schemas and legacy contract fields at the HTTP boundary", async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const transformed = await pipe.transform(
      {
        ...gatewayRequest,
        responseSchemaId: "internal.market-intel-translation",
        responseSchemaVersion: 1,
        responseContract: "market_intel_translation",
        responseSchema: { id: "client.owned-schema", version: 999 },
      },
      { type: "body", metatype: InternalExecuteDto },
    );

    expect(transformed).not.toHaveProperty("responseContract");
    expect(transformed).not.toHaveProperty("responseSchema");
    expect(transformed).toMatchObject({
      responseSchemaId: "internal.market-intel-translation",
      responseSchemaVersion: 1,
    });
  });
});

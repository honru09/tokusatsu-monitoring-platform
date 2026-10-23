import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  internalGatewayResponseSchema,
  internalProductResponseSchema,
} from "./ai-internal-response-contracts.js";

describe("internal AI response contract registry", () => {
  function expectBadRequest(action: () => unknown) {
    try {
      action();
      throw new Error("Expected request validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  }

  it("fails closed for an unknown contract identifier", () => {
    expect(() =>
      internalProductResponseSchema("title_parsing", "client.owned-schema", 1),
    ).toThrow("Unknown response schema id or version");
  });

  it("fails closed when a valid contract is paired with the wrong route", () => {
    expect(() =>
      internalGatewayResponseSchema(
        "crawler_diagnosis",
        "internal.market-intel-translation",
        1,
      ),
    ).toThrow("Response schema is not allowed for task");
    expect(() =>
      internalProductResponseSchema(
        "automatic_classification",
        "internal.china-search-keywords",
        1,
      ),
    ).toThrow("Response schema is not allowed for operation");
  });

  it("requires every expected China candidate exactly once", () => {
    const schema = internalProductResponseSchema(
      "product_identification",
      "internal.china-candidate-decisions",
      1,
      ["listing-a", "listing-b"],
    );
    const decision = (sourceListingId: string) => ({
      sourceListingId,
      sameProduct: true,
      confidence: 0.9,
      accessoryOnly: false,
      damaged: false,
      quantityConflict: false,
      modelConflict: false,
      versionConflict: false,
      scaleConflict: false,
      conditionConflict: false,
      evidence: ["型号一致"],
    });

    expect(
      schema.validate({
        decisions: [decision("listing-a"), decision("listing-b")],
        score: 100,
      }),
    ).toEqual({
      success: true,
      value: {
        decisions: [decision("listing-a"), decision("listing-b")],
      },
    });
    expect(
      schema.validate({ decisions: [decision("listing-a")] }),
    ).toMatchObject({ success: false });
    expect(
      schema.validate({
        decisions: [decision("listing-a"), decision("invented")],
      }),
    ).toMatchObject({ success: false });
  });

  it("requires server-owned context for dynamic contracts", () => {
    expectBadRequest(() =>
      internalProductResponseSchema(
        "image_analysis",
        "internal.china-candidate-decisions",
        1,
        [],
      ),
    );
  });

  it("rejects expected IDs for contracts that do not use them", () => {
    expectBadRequest(() =>
      internalProductResponseSchema(
        "title_parsing",
        "internal.china-search-keywords",
        1,
        ["listing-1"],
      ),
    );
  });

  it("turns malformed runtime operation and context values into HTTP 400", () => {
    for (const operation of ["unknown_operation", "toString"])
      expectBadRequest(() =>
        internalProductResponseSchema(
          operation as never,
          "internal.china-search-keywords",
          1,
        ),
      );
    expectBadRequest(() =>
      internalProductResponseSchema(
        "product_identification",
        "internal.china-candidate-decisions",
        1,
        [42] as never,
      ),
    );
  });
});

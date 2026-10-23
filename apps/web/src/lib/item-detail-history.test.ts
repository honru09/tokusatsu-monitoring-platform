import { describe, expect, it } from "vitest";
import {
  ITEM_DETAIL_HISTORY_STATE_KEY,
  parseItemDetailHistoryState,
  withItemDetailHistoryState,
} from "./item-detail-history";

describe("item detail history state", () => {
  it("adds the item without discarding workspace history", () => {
    expect(
      withItemDetailHistoryState(
        { __tokusatsuWorkspaceNavigation: 1 },
        "item-1",
      ),
    ).toEqual({
      __tokusatsuWorkspaceNavigation: 1,
      [ITEM_DETAIL_HISTORY_STATE_KEY]: "item-1",
    });
  });

  it("accepts only a non-empty string item id", () => {
    expect(
      parseItemDetailHistoryState({
        [ITEM_DETAIL_HISTORY_STATE_KEY]: "item-1",
      }),
    ).toBe("item-1");
    expect(
      parseItemDetailHistoryState({ [ITEM_DETAIL_HISTORY_STATE_KEY]: "" }),
    ).toBeNull();
    expect(parseItemDetailHistoryState(null)).toBeNull();
  });
});

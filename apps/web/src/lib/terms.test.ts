import { describe, expect, it } from "vitest";
import { TERMS } from "./terms";

describe("canonical terms", () => {
  it("names the four primary navigation slots", () => {
    expect(TERMS.todo).toBe("待办");
    expect(TERMS.catalog).toBe("选货");
    expect(TERMS.messages).toBe("消息");
    expect(TERMS.workbench).toBe("工作台");
  });

  it("keeps the purchase flow vocabulary unambiguous", () => {
    // The cart, the send-list and a recorded purchase are three
    // different things and must never share a name.
    expect(TERMS.cart).toBe("购物车");
    expect(TERMS.bundle).toBe("待发清单");
    expect(TERMS.purchases).toBe("购买记录");
    expect(TERMS.registerPurchase).toBe("登记购买");
    expect(new Set([TERMS.cart, TERMS.bundle, TERMS.purchases]).size).toBe(3);
  });

  it("names the todo queues and the unverifiable state", () => {
    expect(TERMS.queueReview).toBe("待评估");
    expect(TERMS.queueNegotiating).toBe("砍价中");
    expect(TERMS.queueRegister).toBe("待登记");
    expect(TERMS.queueInventory).toBe("库存提醒");
    expect(TERMS.queueSystem).toBe("系统提醒");
    expect(TERMS.unverifiable).toBe("暂无法核验");
  });
});

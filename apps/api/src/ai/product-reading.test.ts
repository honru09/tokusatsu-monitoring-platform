import { describe, expect, it, vi } from "vitest";
import { PRODUCT_READING_SCHEMA } from "./product-reading.js";
import { AiSystemService } from "./ai-system.service.js";
describe("Explicit product reading",()=>{
  it("keeps unknown facts null and rejects assertions without evidence",()=>{
    const data={summaryZh:"商品说明",observedFacts:[{field:"配件",value:null,evidence:"原文未说明"}],missingFacts:["配件清单"]};
    expect(PRODUCT_READING_SCHEMA.validate(data)).toEqual({success:true,value:data});
    expect(PRODUCT_READING_SCHEMA.validate({...data,observedFacts:[{field:"配件",value:"齐全",evidence:""}]}).success).toBe(false);
  });
  it("reads only database-owned facts and two images without changing the source item",async()=>{
    const db={item:{findUnique:vi.fn().mockResolvedValue({titleRaw:"资料",descriptionRaw:"原文",conditionRaw:null,priceCurrent:100,shippingFee:null,listingType:"direct",sourceUrl:"https://example.com",images:[{url:"https://static.mercdn.net/a.jpg"},{url:"https://static.mercdn.net/b.jpg"}]})}};
    const ai={execute:vi.fn().mockResolvedValue({data:{}})};
    const service=new AiSystemService(db as never,{} as never,{} as never,{} as never,ai as never);
    await service.readItem("item");
    expect(db.item.findUnique).toHaveBeenCalledWith(expect.objectContaining({select:expect.objectContaining({images:expect.objectContaining({take:2})})}));
    expect(ai.execute).toHaveBeenCalledTimes(1);expect(ai.execute.mock.calls[0][0]).toBe("product_identification");
    expect(ai.execute.mock.calls[0][1]).toMatchObject({itemId:"item",dataClass:"public_market",publicImageUrlsVerified:true,responseSchema:PRODUCT_READING_SCHEMA});
  });
  it("rejects a nonexistent item before making an AI call",async()=>{
    const ai={execute:vi.fn()};const service=new AiSystemService({item:{findUnique:vi.fn().mockResolvedValue(null)}} as never,{} as never,{} as never,{} as never,ai as never);
    await expect(service.readItem("missing")).rejects.toThrow(/不存在/);expect(ai.execute).not.toHaveBeenCalled();
  });
});

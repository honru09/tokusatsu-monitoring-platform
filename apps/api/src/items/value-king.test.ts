import {describe,it,expect,vi} from 'vitest';
import {independentValueKing, type ValueKingListing} from './value-king.js';
import {itemResponseWithChinaComparison} from './item-response.js';
const now=new Date('2026-09-09T08:00:00Z');
const base:ValueKingListing={id:'candidate',sellerId:'seller-a',listingType:'direct',status:'active',channel:'online',titleRaw:'仮面ライダー S.H.Figuarts 5体セット',descriptionRaw:'仮面ライダー S.H.Figuarts 正規品、付属品完備。画像の5体をまとめて出品します。',categoryIp:'kamen_rider',categoryToyType:'figure',collectibleSeries:'shf',conditionGrade:'used',priceCurrent:3000,shippingFee:500,quantityEst:5,lastSeenAt:now,images:[{}]};
describe('value kings independent of Xianyu',()=>{
 it('admits an explicitly counted ultra-low-cost bundle without any Chinese comparison',()=>{expect(independentValueKing(base,now)).toMatchObject({kind:'ultra_low_bundle',referenceBasis:'unit_cost',quantity:5,unitCostJpy:700,xianyuReferencePriceCny:null,netProfitJpy:null});});
 it('compares single items against three independent same-product same-condition sellers',()=>{
   const peers=[8000,8500,9000].map((priceCurrent,i)=>({id:`peer-${i}`,sellerId:`other-${i}`,priceCurrent,shippingFee:0,quantityEst:1,conditionGrade:'used',lastSeenAt:now}));
   expect(independentValueKing({...base,quantityEst:1,product:{listings:peers}},now)).toMatchObject({referenceBasis:'japan_inventory',referencePriceJpy:8000,savingsJpy:4500});
   expect(independentValueKing({...base,quantityEst:1,product:{listings:peers.map(p=>({...p,sellerId:'duplicate'}))}},now)).toBeNull();
   expect(independentValueKing({...base,quantityEst:1,product:{listings:peers.map(p=>({...p,conditionGrade:'new_sealed'}))}},now)).toBeNull();
 });
 it.each([{shippingFee:null},{quantityEst:null},{status:'sold'},{listingType:'auction'},{ignored:true},{purchaseRecord:{}},{conditionGrade:'junk'},{descriptionRaw:'ジャンク 5体セット。説明にある本体は部品取り用です。'},{lastSeenAt:new Date(now.getTime()-90_000_000)},{titleRaw:'仮面ライダー パーツのみ',descriptionRaw:'仮面ライダー S.H.Figuarts 部品のみ5個セットをまとめて販売しています。'},{titleRaw:'仮面ライダー SHF セット',descriptionRaw:'仮面ライダー S.H.Figuarts 一式をまとめて出品します。画像をご確認ください。'}])('rejects missing facts or unsafe candidates %j',patch=>{expect(independentValueKing({...base,...patch},now)).toBeNull();});
 it('keeps admission active with every Xianyu switch disabled, without exposing reference peers',()=>{
   vi.useFakeTimers();vi.setSystemTime(now);vi.stubEnv('CHINA_MARKET_COMPARISON_ENABLED','false');vi.stubEnv('XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED','false');
   try{const output=itemResponseWithChinaComparison({...base,product:{listings:[]}});expect(output.valueKing?.referenceBasis).toBe('unit_cost');expect(output.chinaComparison).toBeNull();expect(output.product).not.toHaveProperty('listings');}finally{vi.useRealTimers();vi.unstubAllEnvs();}
 });
});

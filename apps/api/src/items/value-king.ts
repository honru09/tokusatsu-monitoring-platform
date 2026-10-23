import type { Prisma } from '@tokusatsu/db';

export const valueKingPeerRelation = {
  where:{listingType:'direct',status:'active',channel:'online',archivedAt:null,ignored:false,purchaseRecord:null,quantityEst:1,shippingFee:{not:null},sellerId:{not:null}},
  select:{id:true,sellerId:true,priceCurrent:true,shippingFee:true,quantityEst:true,conditionGrade:true,lastSeenAt:true,shfLine:true,shfEdition:true,shfRegion:true,shfReleaseChannel:true},
  orderBy:{lastSeenAt:'desc'},take:20,
} satisfies Prisma.ItemFindManyArgs;

type Peer={id?:string;sellerId?:string|null;priceCurrent?:number|null;shippingFee?:number|null;quantityEst?:number|null;conditionGrade?:string|null;lastSeenAt?:Date|string|null;shfLine?:string|null;shfEdition?:string|null;shfRegion?:string|null;shfReleaseChannel?:string|null};
export type ValueKingListing=Peer&{
  listingType?:string;status?:string;channel?:string;archivedAt?:Date|string|null;ignored?:boolean;purchaseRecord?:unknown;
  titleRaw?:string;descriptionRaw?:string|null;conditionRaw?:string|null;categoryIp?:string;categoryToyType?:string;collectibleSeries?:string|null;
  images?:unknown[];product?:{listings?:Peer[]}|null;
};
const DAY=86_400_000;
const risk=/(?:ジャンク|junk|故障|動作未確認|破損|欠品|欠損|欠け|部品取り|海賊|非正規|コピー品|偽物|予約|箱のみ|パーツのみ|説明書のみ|手首のみ|武器のみ|ベルト帯のみ|本体なし|本体無し|图册|書籍|カードダス|トレカ|trading card)/iu;
const identity=/(?:仮面ライダー|假面骑士|ウルトラマン|奥特曼|戦隊|ゴジラ|哥斯拉)/u;
const time=(value:Date|string|null|undefined)=>value?new Date(value).getTime():NaN;
const goodPrice=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const knownShipping=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

export function independentValueKing(item:ValueKingListing,now=new Date()) {
  const quantity=Number(item.quantityEst),text=`${item.titleRaw??''}\n${item.descriptionRaw??''}\n${item.conditionRaw??''}`;
  const observed=time(item.lastSeenAt),expires=observed+DAY;
  if(item.listingType!=='direct'||item.status!=='active'||item.channel!=='online'||item.archivedAt||item.ignored||item.purchaseRecord||item.categoryToyType==='card'||
    !goodPrice(item.priceCurrent)||!knownShipping(item.shippingFee)||!Number.isInteger(quantity)||quantity<1||
    !['new_sealed','like_new','used'].includes(item.conditionGrade??'')||!item.images?.length||
    (item.descriptionRaw?.trim().length??0)<24||!identity.test(text)||risk.test(text)||
    !Number.isFinite(observed)||observed>now.getTime()+300_000||expires<=now.getTime())return null;
  const cost=Number(item.priceCurrent)+Number(item.shippingFee),unit=cost/quantity;
  const bySeller=new Map<string,Peer>();
  if(quantity===1&&item.sellerId)for(const peer of item.product?.listings??[]) {
    if(!peer.sellerId||peer.sellerId===item.sellerId||peer.id===item.id||peer.quantityEst!==1||peer.conditionGrade!==item.conditionGrade||
      !goodPrice(peer.priceCurrent)||!knownShipping(peer.shippingFee)||time(peer.lastSeenAt)+DAY<=now.getTime()||
      time(peer.lastSeenAt)>now.getTime()+300_000||!Number.isFinite(time(peer.lastSeenAt))||
      ['shfLine','shfEdition','shfRegion','shfReleaseChannel'].some(key=>(peer[key as keyof Peer]??null)!==(item[key as keyof Peer]??null)))continue;
    const previous=bySeller.get(peer.sellerId);
    if(!previous||Number(peer.priceCurrent)+Number(peer.shippingFee)<Number(previous.priceCurrent)+Number(previous.shippingFee))bySeller.set(peer.sellerId,peer);
  }
  const peers=[...bySeller.values()],reference=peers.length>=3?Math.min(...peers.map(p=>Number(p.priceCurrent)+Number(p.shippingFee))):null;
  const bargain=reference!=null&&reference>=6000&&cost<=reference*0.5&&reference-cost>=3000;
  const explicitQuantities=[...text.matchAll(/(?:^|[^\d])(\d{1,3})\s*(?:点|個|体|件)(?:セット|まとめ|组|組|套|\b|[^\d]|$)/gu)].map(m=>Number(m[1]));
  let ceiling=0,minimum=5;
  if(['shf','sic'].includes(item.collectibleSeries??'')||item.categoryToyType==='dx_belt')ceiling=800;
  else if(['figure','sofubi'].includes(item.categoryToyType??''))ceiling=300;
  else if(['henshin_item','medal','gashapon','shokugan','finger_puppet'].includes(item.categoryToyType??'')){ceiling=100;minimum=10;}
  const bulk=quantity>=minimum&&explicitQuantities.includes(quantity)&&ceiling>0&&unit<=ceiling;
  if(!bargain&&!bulk)return null;
  return {
    kind:bargain?'high_value_low_price' as const:'ultra_low_bundle' as const,label:bargain?'同款显著低价':'超低单价捆包',
    acquisitionCostJpy:cost,unitCostJpy:Math.round(unit),quantity,
    referenceBasis:bargain?'japan_inventory' as const:'unit_cost' as const,referencePriceJpy:bargain?reference:null,referenceSampleCount:bargain?peers.length:0,
    savingsJpy:bargain?reference!-cost:null,xianyuReferencePriceCny:null,netProfitJpy:null,netMarginRatio:null,
    evidenceExpiresAt:new Date(bargain?Math.min(expires,...peers.map(p=>time(p.lastSeenAt)+DAY)):expires),
    facts:[`商品与已知邮费 ¥${cost.toLocaleString('ja-JP')}`,`${quantity} 件 · 单件 ¥${Math.round(unit).toLocaleString('ja-JP')}`,
      bargain?`库内同款、同品相 ${peers.length} 家独立卖家，最低参考 ¥${reference!.toLocaleString('ja-JP')}`:`明确数量捆包，单件成本不高于 ¥${ceiling.toLocaleString('ja-JP')}`],
  };
}

# 平台完整业务与历史数据包 (Platform Complete Business & Seed Data)

本目录包含特摄监控平台的完整核心业务与目录数据快照（已全量导出为结构化 JSON 及 Gzip 压缩包），旨在供后续 AI 助理、自动化流水线或新环境开发者快速读取、理解和使用。

---

## 1. 数据集清单与说明 (Dataset Manifest)

| 文件名 | 格式 | 记录数 / 大小 | 说明 |
| :--- | :--- | :--- | :--- |
| `all_catalog_items.json.gz` | Gzip JSON Array | 50,548 条 (~7.3 MB) | 全量商品档案（ID、平台、原始标题、日中标题、价格、品相、卖家ID等） |
| `all_products.json.gz` | Gzip JSON Array | 46,281 条 (~6.7 MB) | 全量标准化产品库（品牌、IP系列、角色、型号等） |
| `all_sellers.json.gz` | Gzip JSON Array | 19,907 条 (~4.1 MB) | 全量卖家画像（平台、卖家编号、信用评级、评价数等） |
| `all_item_images.json.gz` | Gzip JSON Array | 49,832 条 (~4.1 MB) | 全量商品图片链接与缩略图映射表 |
| `all_classifications_part1.json.gz` | Gzip JSON Array | 35,695 条 (~19.0 MB) | AI 智能分类与研判记录（前半部分） |
| `all_classifications_part2.json.gz` | Gzip JSON Array | 35,695 条 (~21.4 MB) | AI 智能分类与研判记录（后半部分） |
| `all_keyword_matches.json.gz` | Gzip JSON Array | 11,538 条 (~0.3 MB) | 监控关键词与盘源商品的命中关联表 |
| `monitoring_keywords.json` | JSON Array | 25 条 | 核心特摄监控关键词定义及抓取策略配置 |
| `monitoring_categories.json` | JSON Array | 7 条 | 监控品类体系与权重配置 |
| `inventory_orders.json` | JSON Array | 30 条 | 实际采购订单、实付金额、国际物流跟踪单号与入库状态 |
| `purchase_records.json` | JSON Array | 31 条 | 采购明细凭据与结算快照 |
| `purchase_bundles.json` | JSON Array | 33 条 | 合单采购与转运包裹记录 |
| `resale_listings.json` | JSON Array | 32 条 | 国内转售盘源、闲鱼对接铺货信息与定价规则 |
| `resale_settings.json` | JSON Object | 1 条 | 转售自动化、汇率换算与利润率阈值配置 |
| `franchises.json` | JSON Array | 4 条 | 核心大 IP 体系（假面骑士、奥特曼、超级战队、哥斯拉等） |
| `series.json` | JSON Array | 33 条 | 细分剧集/世代系列字典 |
| `product_toy_types.json` | JSON Array | 10 条 | 玩具类型字典（腰带、变身道具、SHF手办、软胶等） |
| `product_manufacturers.json` | JSON Array | 5 条 | 厂商字典（Bandai、Bandai Spirits、P-Bandai 等） |
| `catalog_aliases.json` | JSON Array | 263 条 | 常用日中商品搜索别名与缩写映射词典 |
| `shipping_carriers.json` | JSON Array | 3 条 | 转运仓与物流承运商配置 |
| `shipping_tariffs.json` | JSON Array | 30 条 | 国际与境内阶梯运费费率表 |
| `direct_messages.json` | JSON Array | 151 条 | 站内协同与通知消息记录 |
| `negotiation_cases.json` | JSON Array | 25 条 | 议价与砍价谈判历史案例库 |
| `manager_activities.json` | JSON Array | 121 条 | 管理员与运维操作审计日志 |
| `sample_items_1000.json` | 纯文本 JSON | 1,000 条 (~13.7 MB) | 包含完整关联外键（图片、分类、物流）的精选样例，供 AI 免解压直读 |

---

## 2. 供 AI 快速读取数据的方法 (How AI can read the data)

### Node.js (一键解压并读取任意 `.json.gz`)
```javascript
import fs from 'fs';
import zlib from 'zlib';

function readCompressed(filePath) {
  const buf = fs.readFileSync(filePath);
  return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
}

// 示例：读取全量 5万+ 商品
const items = readCompressed('data/seeds/all_catalog_items.json.gz');
console.log(`已加载 ${items.length} 件商品数据`);
```

### Python
```python
import json
import gzip

with gzip.open('data/seeds/all_catalog_items.json.gz', 'rt', encoding='utf-8') as f:
    items = json.load(f)
    print(f"已加载 {len(items)} 件商品数据")
```

---

## 3. 完整性保证
1. **符合 GitHub 单文件 < 100MB 规范**：所有文件均已压缩并切分，单文件最大不超过 23 MB，可直接安全托管与极速克隆。
2. **免数据库依赖直读**：任何后续大模型（Claude、GPT、Gemini 等）在本地或沙箱内无需启动 PostgreSQL 服务，即可通过原生文件读取任意业务数据。

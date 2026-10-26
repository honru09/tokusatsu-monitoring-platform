/**
 * Small helpers shared by the link-import surfaces (catalog link view
 * and the purchase-records link registration). They lived as private
 * helpers inside page.tsx until the purchase records were extracted
 * into their own component.
 */

/** Extract the distinct public http(s) URLs from free-form pasted text. */
export function publicUrlsFromInput(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>"'，。；;]+/gi) ?? [];
  const urls: string[] = [];
  for (const raw of matches) {
    const candidate = raw.replace(/[)\]}>、，。；;]+$/g, "");
    try {
      const parsed = new URL(candidate);
      if (!/^https?:$/.test(parsed.protocol) || urls.includes(parsed.href))
        continue;
      urls.push(parsed.href);
    } catch {}
  }
  return urls;
}

/** Turn a raw import/analysis failure into a short user-facing line. */
export function friendlyImportError(value?: string | null) {
  if (!value) return "分析未完成，可稍后重试";
  if (
    /42P10|no unique or exclusion constraint|PrismaClient|ConnectorError/i.test(
      value,
    )
  )
    return "卖家资料写入失败；系统已更新，请重新提交该链接";
  if (/failed to fetch|network|timeout|timed out/i.test(value))
    return "网络暂时不可用，请稍后重试";
  if (/NoPublicPriceError|did not contain a public price/i.test(value))
    return "商品页已无公开价格，无法自动分析";
  if (/书籍或卡片/.test(value))
    return "书籍 / 卡片类商品不在登记范围";

  let cleaned = value.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^Error:\s*/i, "");

  const hasCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(
    cleaned,
  );
  if (!hasCjk) {
    return "分析失败，可稍后重试";
  }
  return cleaned.slice(0, 120);
}

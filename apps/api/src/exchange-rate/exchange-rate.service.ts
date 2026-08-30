import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

const PAIR = "JPY_CNY";
const CACHE_MS = 15 * 60_000;

type UpstreamRate = {
  rate: number;
  source: string;
  referenceDate: Date;
};

@Injectable()
export class ExchangeRateService {
  private refreshInFlight?: Promise<UpstreamRate>;

  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const stored = await this.prisma.exchangeRate.findUnique({
      where: { pair: PAIR },
    });
    if (stored && Date.now() - stored.fetchedAt.getTime() < CACHE_MS)
      return this.payload(stored, false);

    try {
      const fresh = await this.refresh();
      const saved = await this.prisma.exchangeRate.upsert({
        where: { pair: PAIR },
        update: {
          rate: fresh.rate,
          source: fresh.source,
          referenceDate: fresh.referenceDate,
          fetchedAt: new Date(),
        },
        create: {
          pair: PAIR,
          baseCurrency: "JPY",
          quoteCurrency: "CNY",
          rate: fresh.rate,
          source: fresh.source,
          referenceDate: fresh.referenceDate,
          fetchedAt: new Date(),
        },
      });
      return this.payload(saved, false);
    } catch (error) {
      if (stored)
        return {
          ...this.payload(stored, true),
          warning: "汇率上游暂时不可用，正在使用最近一次可靠值",
        };
      throw new ServiceUnavailableException(
        `暂时无法取得 JPY/CNY 参考汇率：${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  private refresh() {
    if (!this.refreshInFlight)
      this.refreshInFlight = this.fetchUpstream().finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }

  private async fetchUpstream(): Promise<UpstreamRate> {
    try {
      const response = await fetch(
        "https://api.frankfurter.app/latest?from=JPY&to=CNY",
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error(`Frankfurter ${response.status}`);
      const data = (await response.json()) as {
        date?: string;
        rates?: { CNY?: number };
      };
      const rate = Number(data.rates?.CNY);
      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error("Frankfurter returned an invalid rate");
      return {
        rate,
        source: "ECB via Frankfurter",
        referenceDate: this.referenceDate(data.date),
      };
    } catch (primaryError) {
      const response = await fetch(
        "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok)
        throw new Error(
          `ECB ${response.status}; ${primaryError instanceof Error ? primaryError.message : "primary failed"}`,
        );
      const xml = await response.text();
      const jpy = Number(
        xml.match(/currency=['\"]JPY['\"]\s+rate=['\"]([\d.]+)['\"]/i)?.[1],
      );
      const cny = Number(
        xml.match(/currency=['\"]CNY['\"]\s+rate=['\"]([\d.]+)['\"]/i)?.[1],
      );
      const date = xml.match(/time=['\"](\d{4}-\d{2}-\d{2})['\"]/i)?.[1];
      const rate = cny / jpy;
      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error("ECB returned an invalid cross rate");
      return {
        rate,
        source: "European Central Bank",
        referenceDate: this.referenceDate(date),
      };
    }
  }

  private referenceDate(value?: string) {
    const parsed = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private payload(
    record: {
      rate: unknown;
      source: string;
      referenceDate: Date;
      fetchedAt: Date;
    },
    stale: boolean,
  ) {
    return {
      pair: PAIR,
      baseCurrency: "JPY",
      quoteCurrency: "CNY",
      rate: Number(record.rate),
      source: record.source,
      referenceDate: record.referenceDate.toISOString(),
      fetchedAt: record.fetchedAt.toISOString(),
      stale,
    };
  }
}

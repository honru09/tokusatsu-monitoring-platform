import { Controller, Get, Header } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics() {
    const [items, reviews, failedJobs, activeAuctions] =
      await this.prisma.$transaction([
        this.prisma.item.count(),
        this.prisma.item.count({ where: { needsReview: true } }),
        this.prisma.crawlJob.count({ where: { status: "failed" } }),
        this.prisma.item.count({
          where: { status: "active", auctionEndAt: { gt: new Date() } },
        }),
      ]);
    return [
      "# HELP tokusatsu_items_total Stored items",
      "# TYPE tokusatsu_items_total gauge",
      `tokusatsu_items_total ${items}`,
      "# HELP tokusatsu_manual_review_pending Pending manual reviews",
      "# TYPE tokusatsu_manual_review_pending gauge",
      `tokusatsu_manual_review_pending ${reviews}`,
      "# HELP tokusatsu_crawl_jobs_failed_total Failed crawl job records",
      "# TYPE tokusatsu_crawl_jobs_failed_total gauge",
      `tokusatsu_crawl_jobs_failed_total ${failedJobs}`,
      "# HELP tokusatsu_active_auctions Active auctions",
      "# TYPE tokusatsu_active_auctions gauge",
      `tokusatsu_active_auctions ${activeAuctions}`,
      "",
    ].join("\n");
  }
}

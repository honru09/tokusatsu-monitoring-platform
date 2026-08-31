import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ImportsService } from "./imports.service.js";

@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  list() {
    return this.imports.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.imports.get(id);
  }

  @Post(":id/retry")
  retry(@Param("id") id: string) {
    return this.imports.retry(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.imports.remove(id);
  }
}

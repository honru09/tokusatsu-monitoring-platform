import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true,
  bodyParser: false,
});
// A 3 MiB receipt becomes roughly 4 MiB after base64 encoding. Keep a
// bounded envelope above that payload while rejecting oversized images in
// the purchase service itself.
app.useBodyParser("json", { limit: "5mb" });
app.useBodyParser("urlencoded", { limit: "5mb", extended: true });
app.use(
  (
    _request: unknown,
    response: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  },
);
app.enableCors({
  origin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
  methods: ["GET", "PATCH", "POST", "DELETE", "OPTIONS"],
});
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.enableShutdownHooks();

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
await app.listen(port, "0.0.0.0");
console.log(`Tokusatsu API listening on ${port}`);

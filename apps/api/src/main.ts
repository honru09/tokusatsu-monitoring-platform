import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.enableCors({
  origin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
  methods: ["GET", "PATCH", "POST", "OPTIONS"],
});
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.enableShutdownHooks();

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
await app.listen(port, "0.0.0.0");
console.log(`Tokusatsu API listening on ${port}`);

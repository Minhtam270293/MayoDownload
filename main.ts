import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MediaShuttleService } from "./utils/media-shuttle.service";
import { MayoDownloaderService } from "./utils/mayo-downloader.service";
import { ConfigService } from "@nestjs/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const mediaShuttleService = app.get(MediaShuttleService);
  const mayoDownloaderService = app.get(MayoDownloaderService);

  const configService = app.get(ConfigService);
  const config = configService.get("mediaShuttle");

  await mayoDownloaderService.download();

  // Optionally start the HTTP server if you want
  // await app.listen(3000);
}
bootstrap();

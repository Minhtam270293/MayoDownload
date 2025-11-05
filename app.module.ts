import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import mediaShuttleConfig from "./media-shuttle.config";
import { MediaShuttleService } from "./utils/media-shuttle.service";
import { MayoDownloaderService } from "./utils/mayo-downloader.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "config.env",
      load: [mediaShuttleConfig],
    }),
  ],
  providers: [MediaShuttleService, MayoDownloaderService],
  exports: [MediaShuttleService],
})
export class AppModule {}

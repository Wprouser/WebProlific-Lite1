import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { UPLOADS_ROOT, UPLOADS_URL_PREFIX } from './storage/repositories/local-disk-storage.repository';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  // Served at the bare (non-/api/v1-prefixed) path — setGlobalPrefix only
  // affects controller routes, not static-asset middleware, and item image
  // <img src> tags need a plain URL, not an API route.
  app.useStaticAssets(UPLOADS_ROOT, { prefix: UPLOADS_URL_PREFIX });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

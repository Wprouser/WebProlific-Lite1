import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import { Express, Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { UPLOADS_ROOT, UPLOADS_URL_PREFIX } from './storage/repositories/local-disk-storage.repository';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  // FR-06: keep the untouched request bytes around so PosSignatureGuard can
  // verify the POS webhook's HMAC against exactly what was signed. A
  // signature over a JSON.parse/stringify round trip would reject valid
  // payloads whose key order or number formatting differ from ours.
  app.useBodyParser('json', {
    verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
      req.rawBody = Buffer.from(buf);
    },
  });
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

  // Production: this same process also serves the built frontend (web/dist)
  // so the SPA and API share one origin/URL — no CORS or per-env API base
  // URL config needed. This must be registered before app.init() runs
  // (triggered by listen() below) — Nest's own router terminates any
  // request that doesn't match a controller route with its own 404 rather
  // than calling next(), so anything added after init() never sees a
  // client-side route like /items/123. Filtering by prefix here (not by
  // "did Nest already 404 it") is what lets real /api/v1/* and /uploads/*
  // requests pass through untouched to Nest's actual routing further down.
  const webDist = join(process.cwd(), 'web', 'dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist);
    const expressInstance = app.getHttpAdapter().getInstance() as Express;
    expressInstance.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith(UPLOADS_URL_PREFIX)) {
        return next();
      }
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

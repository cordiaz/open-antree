import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Allow the web app to call the API from the browser.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  // 3000 is taken by apps/web in development.
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();

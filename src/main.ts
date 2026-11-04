import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { BadRequestException, ConsoleLogger, Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/app.config';
import { AllExceptionsFilter } from './presentation/filters/all-exceptions.filter';

function flatten(errors: ValidationError[], parent = ''): { path: string; message: string }[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ path, message }));
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

async function bootstrap() {
  const config = loadConfig(); // fails fast if a secret is missing

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // keeps the exact bytes for HMAC signature verification
    logger: new ConsoleLogger({ json: true, colors: false }), // structured JSON logs
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));
  app.useBodyParser('json', { limit: '10kb' });

  // One structured log line per request (no headers, no query string => no secrets)
  const httpLogger = new Logger('HTTP');
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    res.on('finish', () =>
      httpLogger.log({
        requestId, method: req.method, path: req.originalUrl.split('?')[0],
        status: res.statusCode, ms: Date.now() - start,
      }));
    next();
  });

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request validation failed', details: flatten(errors) }),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Loan Payments API')
        .setDescription('Receives MTN / Airtel payment callbacks, starts payments and exposes payment details.')
        .setVersion('1.0')
        .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
        .build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.port} env=${config.env} mock=${config.providers.mock} swagger=${config.swaggerEnabled}`);
}

bootstrap().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
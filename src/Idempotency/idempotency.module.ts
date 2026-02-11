import { Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service";
import { Idempotency } from "./entities/idempotency.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
import { IdempotencyInterceptor } from "./interceptors/idempotency.interceptor";

@Module({
  imports: [TypeOrmModule.forFeature([Idempotency])],
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
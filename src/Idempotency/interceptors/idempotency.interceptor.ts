import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, of } from "rxjs";
import { tap, catchError } from 'rxjs/operators';
import { IdempotencyService } from "../idempotency.service";

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const key = req.headers['idempotency-key'];

    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    // Check if this key has already been processed
    const record = await this.idempotencyService.findByKey(key);

    if (record?.state === 'completed' && record.response) {
      const cached = record.response as { statusCode?: number; body?: any };
      res.status(cached.statusCode || 200);
      return of(cached.body);
    }

    if (record?.state === 'processing') {
      throw new ConflictException('Request is already being processed');
    }

    // New key or previously failed — mark as processing (atomic upsert)
    await this.idempotencyService.createProcessing(key);

    return next.handle().pipe(
      tap(async (data) => {
        await this.idempotencyService.saveSuccess(key, {
          statusCode: res.statusCode || 200,
          body: data,
        });
      }),
      catchError(async (err) => {
        await this.idempotencyService.saveError(key, err);
        throw err;
      }),
    );
  }
}

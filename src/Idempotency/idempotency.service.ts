import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Idempotency } from "./entities/idempotency.entity";
import { Repository } from "typeorm";

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(Idempotency)
    private readonly repo: Repository<Idempotency>,
  ){}

  async findByKey(key: string): Promise<Idempotency | null> {
    return await this.repo.findOne({ where: { key } });
  }

  async createProcessing(key: string): Promise<void> {
    await this.repo.upsert(
      {
        key,
        state: 'processing',
        response: null,
        error: null as any,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      ['key'],
    );
  }

  async saveSuccess(key: string, response: { statusCode: number; body: any }): Promise<void> {
    await this.repo.update(
      { key },
      {
        state: 'completed',
        response: response as any,
      },
    );
  }

  async saveError(key: string, error: any): Promise<void> {
    await this.repo.update(
      { key },
      {
        state: 'failed',
        error: error?.message || JSON.stringify(error),
      },
    );
  }
}

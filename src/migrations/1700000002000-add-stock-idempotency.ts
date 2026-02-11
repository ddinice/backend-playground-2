import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockIdempotency1700000002000 implements MigrationInterface {
  name = 'AddStockIdempotency1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add stock column to products
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "stock" numeric NOT NULL DEFAULT 0`
    );

    // Add idempotency_key column to orders (unique, nullable)
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "idempotency_key" varchar UNIQUE`
    );

    // Create idempotency table for the interceptor-level cache
    await queryRunner.query(
      `CREATE TABLE "idempotency" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" varchar NOT NULL,
        "response" jsonb,
        "error" text,
        "expires_at" timestamp,
        "state" varchar NOT NULL DEFAULT 'completed',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "IDX_idempotency_key_unique" UNIQUE ("key")
      )`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "idempotency"');
    await queryRunner.query('ALTER TABLE "orders" DROP COLUMN IF EXISTS "idempotency_key"');
    await queryRunner.query('ALTER TABLE "products" DROP COLUMN IF EXISTS "stock"');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrdersCompositeIndex1700000003000 implements MigrationInterface {
  name = 'AddOrdersCompositeIndex1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for the "hot" getOrders query that filters by
    // user_id + status and sorts by created_at DESC.
    // Covers WHERE user_id = ? AND status = ? AND created_at BETWEEN ? AND ?
    // ORDER BY created_at DESC — allows an Index Scan instead of Seq Scan + Sort.
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_user_status_created"
       ON "orders" ("user_id", "status", "created_at" DESC)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_orders_user_status_created"');
  }
}

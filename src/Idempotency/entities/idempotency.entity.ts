import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../entities/base.entity";

@Entity('idempotency')
@Index('IDX_idempotency_key_unique', ['key'], { unique: true })
export class Idempotency extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({unique: true})
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  response: object | null;

  @Column({ type: 'text', nullable: true })
  error: string;

  @Column({ type: 'timestamp', nullable: true, name: 'expires_at' })
  expiresAt?: Date;

  @Column({ type: 'varchar', default: 'completed' })
  state: 'processing' | 'completed' | 'failed';
}
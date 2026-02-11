import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../entities/base.entity';
import { Order } from '../../orders/entities/order.entity';

@Entity('users')
@Index('IDX_users_email_unique', ['email'], { unique: true })
export class User extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];
}

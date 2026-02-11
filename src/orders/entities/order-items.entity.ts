import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../entities/base.entity";
import { Order } from "./order.entity";
import { Product } from "../../products/entities/product.entity";

@Entity('order_items')
export class OrderItem extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;
  @ManyToOne(() => Product, (product) => product.orderItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'int', name: 'quantity' })
  quantity: number;

  @Column('numeric', { precision: 12, scale: 2, name: 'price_at_purchase' })
  priceAtPurchase: string;
}
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Order, OrderStatus } from "./entities/order.entity";
import { Repository } from "typeorm";
import { CreateOrderDto } from "./dto/create-order.dto";
import { GetOrdersQueryDto } from "./dto/get-orders-query.dto";
import { DataSource, In } from 'typeorm';
import { OrderItem } from "./entities/order-items.entity";
import { Product } from "src/products/entities/product.entity";

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    private readonly dataSource: DataSource,
  ){}

  async getOrders(query: GetOrdersQueryDto) {
    const { page = 1, limit = 20, status, userId, createdFrom, createdTo, sortBy = 'createdAt', sortOrder = 'DESC' } = query;

    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items');

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    if (userId) {
      qb.andWhere('order.userId = :userId', { userId });
    }

    if (createdFrom) {
      qb.andWhere('order.createdAt >= :createdFrom', { createdFrom });
    }

    if (createdTo) {
      qb.andWhere('order.createdAt <= :createdTo', { createdTo });
    }

    qb.orderBy(`order.${sortBy}`, sortOrder);

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createOrder(dto: CreateOrderDto, idempotencyKey: string): Promise<Order> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newOrder = queryRunner.manager.create(Order, {
        userId: dto.userId,
        status: OrderStatus.CREATED,
        idempotencyKey,
      });
      await queryRunner.manager.save(newOrder);

      // Lock product rows until transaction commits (SELECT ... FOR UPDATE)
      const products = await queryRunner.manager.find(Product, {
        where: { id: In(dto.items.map(i => i.id)) },
        lock: { mode: 'pessimistic_write' },
      });

      // Validate stock and decrement atomically
      for (const item of dto.items) {
        const product = products.find(p => p.id === item.id);
        if (!product) throw new BadRequestException(`Product ${item.id} not found`);

        const result = await queryRunner.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
          [item.quantity, item.id],
        );

        if (result[1] === 0) {
          throw new BadRequestException(
            `Insufficient stock for product "${product.title}" (available: ${product.stock}, requested: ${item.quantity})`,
          );
        }
      }

      const orderItems = dto.items.map((item) => {
        const product = products.find(p => p.id === item.id)!;

        return queryRunner.manager.create(OrderItem, {
          orderId: newOrder.id,
          productId: item.id,
          quantity: item.quantity,
          priceAtPurchase: product.price,
        });
      });
      await queryRunner.manager.save(orderItems);
      newOrder.items = orderItems;

      await queryRunner.commitTransaction();

      return newOrder;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();

      // Race condition safety net: UNIQUE constraint violation on idempotency_key
      // means a concurrent request already created the order — return it
      if (error.code === '23505' && error.detail?.includes('idempotency_key')) {
        const existing = await this.ordersRepository.findOne({
          where: { idempotencyKey },
          relations: ['items'],
        });
        if (existing) return existing;
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

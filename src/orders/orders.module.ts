import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Order } from "./entities/order.entity";
import { OrderItem } from "./entities/order-items.entity";
import { Product } from "src/products/entities/product.entity";
import { Idempotency } from "src/Idempotency/entities/idempotency.entity";
import { IdempotencyModule } from "src/Idempotency/idempotency.module";
import { DatabaseModule } from "src/db/db.module";

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, Product, Idempotency]), IdempotencyModule, DatabaseModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})

export class OrdersModule {}
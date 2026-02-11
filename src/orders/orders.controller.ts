import { Body, Controller, Get, Headers, Post, Query, UseInterceptors, UsePipes, ValidationPipe } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { Order } from "./entities/order.entity";
import { CreateOrderDto } from "./dto/create-order.dto";
import { GetOrdersQueryDto } from "./dto/get-orders-query.dto";
import { IdempotencyInterceptor } from "src/Idempotency/interceptors/idempotency.interceptor";

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getOrders(@Query() query: GetOrdersQueryDto) {
    return await this.ordersService.getOrders(query);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @UsePipes(ValidationPipe)
  async createOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() order: CreateOrderDto,
  ): Promise<Order> {
    return await this.ordersService.createOrder(order, idempotencyKey);
  }
}

import { Controller, Get } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { Product } from "./entities/product.entity";

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async getProducts(): Promise<Product[]> {
    return await this.productsService.getProducts();
  }
}

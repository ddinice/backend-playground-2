import { IsEnum, IsInt, IsOptional, IsString, IsDateString, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { OrderStatus } from "../entities/order.entity";

export class GetOrdersQueryDto {
  // --- Pagination ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // --- Filters ---
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  // --- Sorting ---
  @IsOptional()
  @IsEnum(['createdAt', 'updatedAt', 'status'], { message: 'sortBy must be one of: createdAt, updatedAt, status' })
  sortBy?: 'createdAt' | 'updatedAt' | 'status' = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'], { message: 'sortOrder must be ASC or DESC' })
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

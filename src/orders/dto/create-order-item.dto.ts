import { IsInt, IsNotEmpty, IsUUID, Min } from "class-validator";

export class CreateOrderItemDto {
  @IsNotEmpty()
  @IsUUID()
  id: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;
}

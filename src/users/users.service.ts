import { Injectable,  } from "@nestjs/common";
import { User } from "./entities/user.entity";
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from "typeorm";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ){}

  async getUsers(): Promise<User[]> {
    return await this.usersRepository.find();
  }

  async getUserById(id: string): Promise<User | null> {
    return await this.usersRepository.findOne({ where: { id } });
  }
}


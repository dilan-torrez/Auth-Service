import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserListDto } from './dto/user-list.dto';
import { plainToInstance } from 'class-transformer';
import { UserDetailDto } from './dto/user-detail.dto';
import { RpcException } from '@nestjs/microservices';
import { NatsService } from 'src/common';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private readonly nats: NatsService,
  ) {}

  async findAll(): Promise<UserListDto[]> {
    const users = await this.userRepository.find({
      select: ['uuid', 'position', 'name'],
    });
    return plainToInstance(UserListDto, users);
  }

  async findOne(uuid: string): Promise<UserDetailDto> {
    const user = await this.userRepository.findOne({
      where: { uuid },
      select: ['uuid', 'username', 'name', 'position'],
    });

    if (!user) {
      throw new RpcException({
        message: `user with: ${uuid} not found`,
        code: 404,
      });
    }
    return plainToInstance(UserDetailDto, user);
  }

  async getManagementModules(userId: number): Promise<any[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['userManagementModules'],
      select: {
        id: true,
        userManagementModules: {
          id: true,
          moduleId: true,
        },
      },
    });
    if (!user || !user.userManagementModules?.length) {
      return [];
    }
    const uniqueModuleIds = [
      ...new Set(
        user.userManagementModules
          .map((umm) => umm.moduleId)
          .filter((id) => !!id),
      ),
    ];
    const modules = await Promise.all(
      uniqueModuleIds.map((id) => this.getModuleById(id)),
    );
    return modules.filter((mod) => mod !== null);
  }

  async getModuleById(moduleId: number): Promise<any | null> {
    if (!moduleId) {
      return null;
    }

    try {
      const module = await this.nats.firstValueExclude(
        { id: moduleId }, // 'params'
        'modules.findOne', // 'service'
        ['createdAt', 'updatedAt', 'deletedAt', 'name', 'shortened', 'status'], // 'keysToOmit'
      );

      if (!module) {
        console.log(`Module with ID ${moduleId} not found via NATS`);
        return null;
      }

      return module;
    } catch (error) {
      console.log(
        `Error fetching module with ID ${moduleId} via NATS: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  async getModulesAndRoles(user: User): Promise<any[]> {
    if (!user?.userRoles?.length) return [];
    const roleMap = new Map<number, { id: number; name: string }[]>();
    for (const userRole of user.userRoles) {
      const role = userRole.role;
      if (!role?.moduleId) continue;
      if (!roleMap.has(role.moduleId)) {
        roleMap.set(role.moduleId, []);
      }
      roleMap.get(role.moduleId)!.push({
        id: role.id,
        name: role.name,
      });
    }

    const moduleIds = Array.from(roleMap.keys());
    const modules = await Promise.all(
      moduleIds.map((id) => this.getModuleById(id)),
    );
    return modules
      .map((mod) => {
        if (!mod) return null;
        return {
          id: mod.id,
          name: mod.displayName,
          urlProd: mod.urlProd,
          urlDev: mod.urlDev,
          urlManual: mod.urlManual,
          roles: roleMap.get(mod.id) || [],
        };
      })
      .filter((mod) => mod !== null);
  }
  async getModulesWithoutRoles(user: User): Promise<any[]> {
    const modulesWithRoles = await this.getModulesAndRoles(user);
    return modulesWithRoles.map((mod) => {
      const modCopy = { ...mod };
      delete modCopy.roles;
      return modCopy;
    });
  }
}

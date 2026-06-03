import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from 'generated/prisma/enums';

@Controller('api/v1/admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('system')
  async getSystem() {
    return this.adminService.getSystemInfo();
  }

  @Get('gateway')
  async getGateway() {
    return this.adminService.getGatewayStatus();
  }

  @Get('pm2')
  async getPm2() {
    return this.adminService.getPm2Status();
  }

  @Post('pm2/restart')
  @HttpCode(HttpStatus.OK)
  async restartPm2() {
    return this.adminService.restartPm2();
  }

  @Get('logs')
  async getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getLogs(
      page ? Math.max(1, parseInt(page, 10)) : 1,
      limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 50,
    );
  }

  @Get('config')
  async getConfigs() {
    return this.adminService.getConfigs();
  }

  @Put('config/:key')
  async upsertConfig(
    @Param('key') key: string,
    @Body() body: { value: string; description?: string },
  ) {
    return this.adminService.upsertConfig(key, body.value, body.description);
  }

  @Delete('config/:key')
  @HttpCode(HttpStatus.OK)
  async deleteConfig(@Param('key') key: string) {
    await this.adminService.deleteConfig(key);
    return { message: `Config "${key}" deleted` };
  }
}

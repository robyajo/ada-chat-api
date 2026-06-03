import { Injectable, NotFoundException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { PatuihService } from '../patuih/patuih.service';

const execAsync = promisify(exec);

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private patuihService: PatuihService,
  ) {}

  async getSystemInfo() {
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'N/A';
    const cpuCores = cpus.length;
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      nodeVersion: process.version,
      processUptime: process.uptime(),
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        load1: loadAvg[0],
        load5: loadAvg[1],
        load15: loadAvg[2],
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
      },
    };
  }

  async getGatewayStatus() {
    return this.patuihService.getGatewayStatus();
  }

  async getLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.loginLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, username: true, displayName: true, role: true } },
        },
      }),
      this.prisma.loginLog.count(),
    ]);
    return {
      logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      totalMessages,
      totalRooms,
      activeUsersToday,
      loginLogsToday,
      totalContacts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.message.count(),
      this.prisma.room.count(),
      this.prisma.loginLog.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.loginLog.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.contact.count({ where: { status: 'ACCEPTED' } }),
    ]);

    const recentUsers = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        provider: true,
        role: true,
        createdAt: true,
      },
    });

    return {
      totalUsers,
      totalMessages,
      totalRooms,
      activeUsersToday,
      loginLogsToday,
      totalContacts,
      recentUsers,
    };
  }

  async getConfigs() {
    return this.prisma.appConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertConfig(key: string, value: string, description?: string) {
    return this.prisma.appConfig.upsert({
      where: { key },
      create: { key, value, description },
      update: { value, description },
    });
  }

  async deleteConfig(key: string) {
    const existing = await this.prisma.appConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Config "${key}" not found`);
    await this.prisma.appConfig.delete({ where: { key } });
  }

  async getPm2Status() {
    try {
      const { stdout } = await execAsync('pm2 jlist');
      const processes = JSON.parse(stdout);
      const app = processes.find((p: any) => p.name === 'ada-chat-api');
      if (!app) return { running: false, message: 'Process ada-chat-api not found in PM2' };
      return {
        running: app.pm2_env.status === 'online',
        status: app.pm2_env.status,
        pid: app.pid,
        uptime: app.pm2_env.pm_uptime ? Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1000) : 0,
        restarts: app.pm2_env.restart_time,
        cpu: app.monit?.cpu ?? 0,
        memory: app.monit?.memory ?? 0,
        version: app.pm2_env.version || 'N/A',
        execPath: app.pm2_env.exec_interpreter || 'node',
      };
    } catch {
      return { running: false, message: 'PM2 not available or not running' };
    }
  }

  async restartPm2() {
    exec('pm2 restart ada-chat-api', (err) => {
      if (err) {
        this.logger.error(`PM2 restart failed: ${err.message}`);
      } else {
        this.logger.log('PM2 restart executed successfully');
      }
    });
    return { success: true, message: 'ada-chat-api is restarting via PM2...' };
  }
}

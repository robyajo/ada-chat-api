import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { SmsModule } from './modules/sms/sms.module';
import { PrismaModule } from './prisma/prisma.module';
import { PatuihModule } from './modules/patuih/patuih.module';
import { RedisModule } from './modules/redis/redis.module';
import { ChatModule } from './modules/chat/chat.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { MomentsModule } from './modules/moments/moments.module';
import { AdminModule } from './modules/admin/admin.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule,
    AuthModule,
    MailModule,
    SmsModule,
    PrismaModule,
    PatuihModule,
    RedisModule,
    ChatModule,
    ContactsModule,
    MomentsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

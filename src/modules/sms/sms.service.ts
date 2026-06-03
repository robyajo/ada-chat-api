import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private client: twilio.Twilio | null = null;
  private readonly fromNumber: string;

  constructor(configService: ConfigService) {
    const accountSid = configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = configService.get<string>('TWILIO_FROM_NUMBER') ?? '';

    if (accountSid && authToken && this.fromNumber) {
      this.client = twilio(accountSid, authToken);
    } else {
      this.logger.warn('Twilio not configured — SMS will be logged only');
    }
  }

  async sendOtp(phone: string, otp: string): Promise<void> {
    if (this.client) {
      await this.client.messages.create({
        body: `Your Ada Chat verification code is: ${otp}. Valid for 5 minutes.`,
        from: this.fromNumber,
        to: phone,
      });
      this.logger.log(`OTP sent to ${phone}`);
    } else {
      this.logger.log(`[DEV] OTP for ${phone}: ${otp}`);
    }
  }
}

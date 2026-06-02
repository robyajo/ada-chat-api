import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PatuihService } from './patuih.service';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [PatuihService],
  exports: [PatuihService],
})
export class PatuihModule {}

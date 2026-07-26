import { Module } from '@nestjs/common';
import { EMAIL_PROVIDER } from './providers/tokens';
import { DevEmailProvider } from './providers/dev-email.provider';

@Module({
  providers: [{ provide: EMAIL_PROVIDER, useClass: DevEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}

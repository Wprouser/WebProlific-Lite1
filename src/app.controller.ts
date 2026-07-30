import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/guards/public.decorator';

@Controller('health')
export class AppController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}

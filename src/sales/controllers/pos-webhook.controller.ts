import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/guards/public.decorator';
import { PosSignatureGuard } from '../guards/pos-signature.guard';
import { SalesService } from '../services/sales.service';
import { PosSaleDto } from '../dto/pos-sale.dto';
import { PosVoidDto } from '../dto/pos-void.dto';

/**
 * FR-06 Model 1 — the live POS integration. Server-to-server, so `@Public()`
 * lifts the JWT requirement and `PosSignatureGuard` authenticates by HMAC
 * instead.
 *
 * Both routes answer 200 for every outcome a POS could retry on. That is the
 * spec's own rule for a missing recipe ("do not fail the webhook") applied
 * consistently: a webhook that 500s gets retried, and a retried sale that
 * *did* record is worse than one that recorded with a warning. The response
 * body always says what actually happened, so an integrator polling it can
 * still tell a deduction from a skip.
 */
@Controller('pos-webhook')
export class PosWebhookController {
  constructor(private readonly salesService: SalesService) {}

  @Post('sale')
  @Public()
  @UseGuards(PosSignatureGuard)
  @HttpCode(200)
  async sale(@Body() dto: PosSaleDto) {
    const result = await this.salesService.recordWebhookSale(dto);
    return {
      saleId: result.sale.id,
      // Spec: "if posReferenceId already exists, return 200 without
      // reprocessing" — the flag is what tells the caller which happened.
      alreadyProcessed: result.alreadyProcessed,
      deducted: result.deducted,
      recipeVersionUsed: result.sale.recipeVersionUsed,
      warnings: result.warnings.map((warning) => ({ code: warning.action, message: warning.message })),
    };
  }

  @Post('void')
  @Public()
  @UseGuards(PosSignatureGuard)
  @HttpCode(200)
  async void(@Body() dto: PosVoidDto) {
    return this.salesService.voidByPosReference(dto);
  }
}

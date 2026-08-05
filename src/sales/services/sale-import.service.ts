import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SALE_IMPORT_REPOSITORY } from '../repositories/tokens';
import { SaleImportRepository } from '../repositories/sale-import.repository';
import { MENU_ITEM_REPOSITORY } from '../../recipes/repositories/tokens';
import { MenuItemRepository } from '../../recipes/repositories/menu-item.repository';
import { RequestWithAccess } from '../../tenancy/types/request-with-access';
import { assertOutletAccess } from '../../tenancy/access.util';
import { Role } from '../../tenancy/constants/enums';
import { DEFAULT_SALES_DATE_FORMAT, SALES_MUTATE_ROLES, SalesDateFormat } from '../constants/enums';
import { findBestFuzzyMatch } from '../../invoice-scans/lib/fuzzy-match';
import { ParseSalesFileResult, SalesFileFormatError, parseSalesFile } from '../lib/parse-sales-file';
import { SaleImportBatch, SaleImportRowWithMenuItem } from '../domain/sale.entity';
import { ProjectedIngredientImpact, SaleDeductionService, SaleWarning } from './sale-deduction.service';
import { ActivityBus } from '../../activity-log/services/activity-bus.service';

export interface UploadedSalesFile {
  buffer: Buffer;
  originalName: string;
}

export interface StagedBatchResult {
  batch: SaleImportBatch;
  /** Lines the file contained that were not sale rows at all (footers, junk),
   * reported by line number so the user can check them against the file. */
  skippedLines: ParseSalesFileResult['skipped'];
}

export interface BatchReview {
  batch: SaleImportBatch;
  rows: SaleImportRowWithMenuItem[];
  matchedCount: number;
  unmatchedCount: number;
  /** The server-computed impact preview — what running this batch would do
   * to ingredient stock. */
  projectedImpact: ProjectedIngredientImpact[];
  /** Matched menu items with no recipe: they will be recorded as sales but
   * deduct nothing, so the preview understates the real-world consumption. */
  unmappedMenuItemIds: string[];
}

export interface BatchRunResult {
  batch: SaleImportBatch;
  processedRows: number;
  skippedRows: number;
  warnings: SaleWarning[];
}

@Injectable()
export class SaleImportService {
  constructor(
    @Inject(SALE_IMPORT_REPOSITORY) private readonly importRepository: SaleImportRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly menuItemRepository: MenuItemRepository,
    private readonly saleDeductionService: SaleDeductionService,
    private readonly activityBus: ActivityBus,
  ) {}

  /**
   * Step 1 — Upload. Parses the file, fuzzy-matches each row to a menu item,
   * and stages the result.
   *
   * Emphatically deducts nothing: the whole point of the two-step design is
   * that stock only moves when a human clicks "Run BOM" having seen the
   * projected impact. A batch leaves here as STAGED, every time.
   */
  async stageUpload(
    request: RequestWithAccess,
    outletId: string,
    file: UploadedSalesFile,
    dateFormat: SalesDateFormat = DEFAULT_SALES_DATE_FORMAT,
  ): Promise<StagedBatchResult> {
    assertOutletAccess(request, outletId, [...SALES_MUTATE_ROLES] as Role[]);

    let parsed: ParseSalesFileResult;
    try {
      parsed = await parseSalesFile(file.originalName, file.buffer, dateFormat);
    } catch (error) {
      // A file we can't read is the user's problem to fix and re-upload —
      // the only place in FR-06 where refusing outright is the right call,
      // because there is no partial sale data to preserve.
      if (error instanceof SalesFileFormatError) throw new BadRequestException(error.message);
      throw error;
    }

    const candidates = (await this.menuItemRepository.findScoped({
      accessibleOutletIds: [outletId],
      outletId,
    })).map((menuItem) => ({ id: menuItem.id, name: menuItem.name }));

    const batch = await this.importRepository.createWithRows({
      outletId,
      fileName: file.originalName,
      importedById: request.user!.id,
      rows: parsed.rows.map((row) => {
        // Try the SKU-ish column first: an exact-ish code match beats a
        // fuzzy name match, and the same helper handles both since a menu
        // item's "name" is all we have to match against either way.
        const matchedMenuItemId =
          (row.sku ? findBestFuzzyMatch(row.sku, candidates) : null) ??
          findBestFuzzyMatch(row.menuItemName, candidates);
        return {
          rowNumber: row.rowNumber,
          rawMenuItemName: row.menuItemName,
          rawSku: row.sku,
          quantitySold: row.quantitySold,
          saleDate: row.saleDate,
          posReferenceRaw: row.posReferenceRaw,
          matchedMenuItemId,
          matchStatus: matchedMenuItemId ? ('MATCHED' as const) : ('UNMATCHED' as const),
        };
      }),
    });

    return { batch, skippedLines: parsed.skipped };
  }

  /** Step 2 — Review. */
  async review(request: RequestWithAccess, batchId: string): Promise<BatchReview> {
    const batch = await this.getBatchOrThrow(request, batchId);
    const rows = await this.importRepository.findRows(batchId);

    const matched = rows.filter((row) => row.matchedMenuItemId);
    const { impact, unresolvableMenuItemIds } = await this.saleDeductionService.projectImpact(
      matched.map((row) => ({ menuItemId: row.matchedMenuItemId!, quantitySold: row.quantitySold })),
    );

    return {
      batch,
      rows,
      matchedCount: matched.length,
      unmatchedCount: rows.length - matched.length,
      projectedImpact: impact,
      unmappedMenuItemIds: unresolvableMenuItemIds,
    };
  }

  async assignRow(
    request: RequestWithAccess,
    batchId: string,
    rowId: string,
    menuItemId: string,
  ): Promise<SaleImportRowWithMenuItem> {
    const batch = await this.getBatchOrThrow(request, batchId);
    assertOutletAccess(request, batch.outletId, [...SALES_MUTATE_ROLES] as Role[]);
    if (batch.status !== 'STAGED') {
      throw new ConflictException('This batch has already been run and can no longer be edited.');
    }

    const row = await this.importRepository.findRowById(rowId);
    if (!row || row.batchId !== batchId) throw new NotFoundException(`Row ${rowId} not found in this batch`);

    const menuItem = await this.menuItemRepository.findById(menuItemId);
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);
    if (menuItem.outletId !== batch.outletId) {
      throw new BadRequestException("That menu item belongs to a different outlet than this batch's.");
    }

    await this.importRepository.assignRowMenuItem(rowId, menuItemId);
    const rows = await this.importRepository.findRows(batchId);
    return rows.find((r) => r.id === rowId)!;
  }

  /**
   * Step 3 — "Run BOM". The deliberate, reviewed commit: this is where Sale
   * rows are created and stock actually moves.
   *
   * Rows are processed one at a time and independently. A row with no match,
   * or whose menu item has no recipe, is skipped with a reason recorded
   * against it and never halts the rest — a single unmapped dish in a
   * 300-row day's sales must not cost the other 299 their deduction.
   *
   * Re-running is safe: each row's generated `import:<batchId>:<rowNumber>`
   * reference hits the same unique constraint the webhook path relies on, so
   * a second run finds every sale already recorded and deducts nothing.
   */
  async run(request: RequestWithAccess, batchId: string): Promise<BatchRunResult> {
    const batch = await this.getBatchOrThrow(request, batchId);
    assertOutletAccess(request, batch.outletId, [...SALES_MUTATE_ROLES] as Role[]);
    if (batch.status === 'PROCESSING') {
      throw new ConflictException('This batch is already being processed.');
    }

    await this.importRepository.updateBatchStatus(batchId, { status: 'PROCESSING' });

    const rows = await this.importRepository.findRows(batchId);
    const warnings: SaleWarning[] = [];
    let processed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.matchedMenuItemId) {
        await this.importRepository.markRowProcessed(row.id, {
          saleId: null,
          skipReason: `No menu item matched "${row.rawMenuItemName}"`,
        });
        skipped++;
        continue;
      }

      try {
        const result = await this.saleDeductionService.recordSale({
          outletId: batch.outletId,
          menuItemId: row.matchedMenuItemId,
          quantitySold: row.quantitySold,
          posReferenceId: `import:${batchId}:${row.rowNumber}`,
          sourceType: 'BATCH_IMPORT',
          importBatchId: batchId,
          saleTimestamp: row.saleDate,
        });
        warnings.push(...result.warnings);
        await this.importRepository.markRowProcessed(row.id, {
          saleId: result.sale.id,
          skipReason: result.deducted
            ? null
            : result.alreadyProcessed
              ? 'Already processed by an earlier run'
              : 'Recorded, but the menu item has no recipe so nothing was deducted',
        });
        processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.importRepository.markRowProcessed(row.id, { saleId: null, skipReason: message });
        skipped++;
      }
    }

    const finalBatch = await this.importRepository.updateBatchStatus(batchId, {
      status: skipped > 0 || warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
      processedRows: processed,
      processedAt: new Date(),
    });

    await this.activityBus.record({
      userId: request.user!.id,
      category: 'STOCK',
      action: 'RUN_SALE_IMPORT_BATCH',
      entityType: 'SaleImportBatch',
      entityId: batchId,
      outletId: batch.outletId,
      descriptionKey: 'activity.saleimportbatch.run',
      metadata: { processed, skipped, warningCount: warnings.length },
    });

    return { batch: finalBatch, processedRows: processed, skippedRows: skipped, warnings };
  }

  async listBatches(request: RequestWithAccess, outletId?: string): Promise<SaleImportBatch[]> {
    return this.importRepository.findBatchesForOutlets(
      request.effectiveAccess!.effectiveOutletIds,
      outletId,
    );
  }

  private async getBatchOrThrow(request: RequestWithAccess, batchId: string): Promise<SaleImportBatch> {
    const batch = await this.importRepository.findBatchById(batchId);
    if (!batch) throw new NotFoundException(`Import batch ${batchId} not found`);
    assertOutletAccess(request, batch.outletId);
    return batch;
  }
}

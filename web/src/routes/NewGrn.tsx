import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, PenLine, ScanLine } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

/**
 * FR-04's "New GRN" entry point. Direct Entry and Against-a-PO are the two
 * fully working flows. Scan Invoice (Flow 3) is deliberately disabled here —
 * it's on hold pending a real OCR/document-AI provider decision (Claude
 * vision, Google Cloud Vision, AWS Textract, Azure Form Recognizer), so it's
 * shown as a "Coming Soon" card rather than linked through to a flow that
 * can't actually deliver on its promise yet.
 */
export function NewGrn() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const poId = searchParams.get('poId');

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navigate('/grn')}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('grn.back')}
      </button>

      <h1 className="font-display text-xl font-semibold text-foreground">{t('grn.new.title')}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button
          onClick={() => navigate(poId ? `/grn/new/po/${poId}` : '/grn/new/po')}
          className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface p-5 text-left transition-colors duration-200 hover:border-primary hover:bg-surface-secondary/40"
        >
          <FileText className="h-6 w-6 text-primary" />
          <span className="font-display text-base font-semibold text-foreground">{t('grn.new.againstPo.title')}</span>
          <span className="text-sm text-foreground-muted">{t('grn.new.againstPo.description')}</span>
        </button>

        <button
          onClick={() => navigate('/grn/new/direct')}
          className="flex flex-col gap-3 rounded-lg border border-border-strong bg-surface p-5 text-left transition-colors duration-200 hover:border-primary hover:bg-surface-secondary/40"
        >
          <PenLine className="h-6 w-6 text-primary" />
          <span className="font-display text-base font-semibold text-foreground">{t('grn.new.direct.title')}</span>
          <span className="text-sm text-foreground-muted">{t('grn.new.direct.description')}</span>
        </button>

        <div
          className="flex cursor-not-allowed flex-col gap-3 rounded-lg border border-border-strong bg-surface p-5 text-left opacity-60"
          title={t('grn.new.scan.comingSoonTooltip')}
          aria-disabled="true"
        >
          <div className="flex items-center justify-between">
            <ScanLine className="h-6 w-6 text-foreground-muted" />
            <Badge variant="neutral">{t('grn.new.scan.comingSoonBadge')}</Badge>
          </div>
          <span className="font-display text-base font-semibold text-foreground">{t('grn.new.scan.title')}</span>
          <span className="text-sm text-foreground-muted">{t('grn.new.scan.description')}</span>
        </div>
      </div>
    </div>
  );
}

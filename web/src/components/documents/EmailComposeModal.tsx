import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api-client';

export interface SendEmailValues {
  toEmail?: string;
  ccEmails?: string[];
  subject?: string;
  message?: string;
}

export interface EmailComposeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled from the supplier's email on file (spec) — still editable,
   * and may be empty if the supplier has none, in which case the user must
   * enter one before sending. */
  defaultToEmail: string;
  defaultSubject: string;
  defaultMessage: string;
  /** Spec: "emailing a DRAFT PO should show a mild confirmation... since
   * sending an unapproved order to a supplier is usually a mistake." */
  showDraftWarning?: boolean;
  onSend: (values: SendEmailValues) => Promise<void>;
}

export function EmailComposeModal({
  open,
  onOpenChange,
  defaultToEmail,
  defaultSubject,
  defaultMessage,
  showDraftWarning,
  onSend,
}: EmailComposeModalProps) {
  const { t } = useTranslation();
  const [toEmail, setToEmail] = useState(defaultToEmail);
  const [ccEmails, setCcEmails] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [confirmingDraft, setConfirmingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setToEmail(defaultToEmail);
      setCcEmails('');
      setSubject(defaultSubject);
      setMessage(defaultMessage);
      setConfirmingDraft(false);
      setError(null);
    }
  }, [open, defaultToEmail, defaultSubject, defaultMessage]);

  async function doSend() {
    setError(null);
    setSending(true);
    try {
      await onSend({
        toEmail: toEmail || undefined,
        ccEmails: ccEmails
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
        subject: subject || undefined,
        message: message || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('documents.email.sendError'));
      setConfirmingDraft(false);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit() {
    if (showDraftWarning && !confirmingDraft) {
      setConfirmingDraft(true);
      return;
    }
    void doSend();
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('documents.email.title')}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('documents.email.to')}</span>
          <Input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('documents.email.cc')}</span>
          <Input
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            placeholder={t('documents.email.ccPlaceholder')}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('documents.email.subject')}</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('documents.email.message')}</span>
          <textarea
            className="min-h-24 rounded-md border border-border-strong bg-surface p-3 text-sm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>

        {confirmingDraft && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {t('documents.email.draftWarning')}
          </p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('purchaseOrders.form.cancel')}
          </Button>
          <Button disabled={sending || !toEmail} onClick={handleSubmit}>
            {sending
              ? t('documents.email.sending')
              : confirmingDraft
                ? t('documents.email.confirmSendAnyway')
                : t('documents.email.send')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

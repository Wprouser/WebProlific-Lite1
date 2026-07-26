import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmailComposeModal } from './EmailComposeModal';
import { ApiError } from '@/lib/api-client';

function renderModal(overrides: Partial<React.ComponentProps<typeof EmailComposeModal>> = {}) {
  const onOpenChange = vi.fn();
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(
    <EmailComposeModal
      open
      onOpenChange={onOpenChange}
      defaultToEmail="supplier@example.com"
      defaultSubject="Purchase Order #ABCD1234"
      defaultMessage="Please find attached our purchase order."
      onSend={onSend}
      {...overrides}
    />,
  );
  return { onOpenChange, onSend };
}

describe('EmailComposeModal', () => {
  it('AC: pre-fills the recipient from the supplier email, but it stays editable', async () => {
    renderModal();
    const toInput = screen.getByLabelText('To') as HTMLInputElement;
    expect(toInput.value).toBe('supplier@example.com');

    await userEvent.clear(toInput);
    await userEvent.type(toInput, 'override@example.com');
    expect(toInput.value).toBe('override@example.com');
  });

  it('sends with the edited values when confirmed', async () => {
    const { onSend, onOpenChange } = renderModal();
    await userEvent.clear(screen.getByLabelText('Subject'));
    await userEvent.type(screen.getByLabelText('Subject'), 'Custom subject');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'supplier@example.com', subject: 'Custom subject' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('AC: emailing a DRAFT PO shows a confirmation prompt before actually sending', async () => {
    const { onSend } = renderModal({ showDraftWarning: true });

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/hasn't been approved yet/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send Anyway' }));
    expect(onSend).toHaveBeenCalled();
  });

  it('parses a comma-separated CC list into an array', async () => {
    const { onSend } = renderModal();
    await userEvent.type(screen.getByLabelText('Cc'), 'a@example.com, b@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ ccEmails: ['a@example.com', 'b@example.com'] }),
    );
  });

  it('shows an error message when sending fails, without closing the modal', async () => {
    const onOpenChange = vi.fn();
    const onSend = vi.fn().mockRejectedValue(new ApiError(400, 'No recipient email is on file'));
    render(
      <EmailComposeModal
        open
        onOpenChange={onOpenChange}
        defaultToEmail=""
        defaultSubject="Subject"
        defaultMessage="Message"
        onSend={onSend}
      />,
    );
    await userEvent.type(screen.getByLabelText('To'), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('No recipient email is on file')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables Send when there is no recipient at all', () => {
    renderModal({ defaultToEmail: '' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

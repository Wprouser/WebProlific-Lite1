import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export interface StagedImagePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/**
 * Create-mode counterpart to ItemImageGallery. There's no itemId yet to
 * attach a real ItemImage row to (that FK is required — see the schema),
 * so files are held client-side here and uploaded one-by-one immediately
 * after the item itself is created (see ItemFormModal.handleSubmit). The
 * first picked file is shown as primary, matching the server's own "first
 * upload is automatically primary" rule that applies once these are
 * actually uploaded.
 */
export function StagedImagePicker({ files, onChange }: StagedImagePickerProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onChange([...files, file]);
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t('items.detail.overview.images')}</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {t('items.detail.overview.uploadImage')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('items.detail.overview.noImages')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((_file, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-md border border-border bg-surface-secondary"
            >
              {previewUrls[index] && (
                <img src={previewUrls[index]} alt="" className="aspect-square w-full object-cover" />
              )}
              {index === 0 && (
                <Badge variant="success-solid" className="absolute left-2 top-2">
                  {t('items.detail.overview.primaryBadge')}
                </Badge>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-black/50 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  title={t('items.detail.overview.deleteImage')}
                  className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/20"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

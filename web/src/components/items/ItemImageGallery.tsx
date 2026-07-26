import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { itemImagesApi, type ApiItemImage } from '@/lib/items-api';
import { ApiError } from '@/lib/api-client';

export interface ItemImageGalleryProps {
  itemId: string;
  images: ApiItemImage[];
  onChanged: () => void;
}

/** FR-01's item image gallery — upload, mark-primary, delete. Business
 * rules (first upload auto-primary, deleting the primary promotes the
 * next-oldest remaining image) are enforced server-side; this component
 * just reflects whatever the server returns after each action. */
export function ItemImageGallery({ itemId, images, onChanged }: ItemImageGalleryProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await itemImagesApi.upload(itemId, file);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.overview.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleSetPrimary(imageId: string) {
    setBusyImageId(imageId);
    setError(null);
    try {
      await itemImagesApi.setPrimary(itemId, imageId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.overview.uploadError'));
    } finally {
      setBusyImageId(null);
    }
  }

  async function handleDelete(imageId: string) {
    setBusyImageId(imageId);
    setError(null);
    try {
      await itemImagesApi.delete(itemId, imageId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('items.detail.overview.uploadError'));
    } finally {
      setBusyImageId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t('items.detail.overview.images')}</h3>
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {uploading ? t('items.detail.overview.uploading') : t('items.detail.overview.uploadImage')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {images.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('items.detail.overview.noImages')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image) => (
            <div key={image.id} className="group relative overflow-hidden rounded-md border border-border bg-surface-secondary">
              <img src={image.url} alt="" className="aspect-square w-full object-cover" />
              {image.isPrimary && (
                <Badge variant="success-solid" className="absolute left-2 top-2">
                  {t('items.detail.overview.primaryBadge')}
                </Badge>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-black/50 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                {!image.isPrimary && (
                  <button
                    type="button"
                    disabled={busyImageId === image.id}
                    onClick={() => handleSetPrimary(image.id)}
                    title={t('items.detail.overview.setPrimary')}
                    className="flex h-8 w-8 items-center justify-center rounded text-white hover:bg-white/20"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyImageId === image.id}
                  onClick={() => handleDelete(image.id)}
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

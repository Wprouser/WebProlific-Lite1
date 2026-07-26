import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ItemImageGallery } from './ItemImageGallery';
import { itemImagesApi, type ApiItemImage } from '@/lib/items-api';

vi.mock('@/lib/items-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/items-api')>('@/lib/items-api');
  return {
    ...actual,
    itemImagesApi: {
      list: vi.fn(),
      upload: vi.fn(),
      setPrimary: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const primary: ApiItemImage = {
  id: 'img1',
  itemId: 'i1',
  url: '/uploads/items/i1/one.png',
  isPrimary: true,
  sortOrder: 0,
  createdAt: new Date().toISOString(),
};
const secondary: ApiItemImage = {
  id: 'img2',
  itemId: 'i1',
  url: '/uploads/items/i1/two.png',
  isPrimary: false,
  sortOrder: 1,
  createdAt: new Date().toISOString(),
};

describe('ItemImageGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an empty message when there are no images', () => {
    render(<ItemImageGallery itemId="i1" images={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('No images yet')).toBeInTheDocument();
  });

  it('AC: marks exactly one image as primary, with a visible badge', () => {
    render(<ItemImageGallery itemId="i1" images={[primary, secondary]} onChanged={vi.fn()} />);
    expect(screen.getAllByText('Primary')).toHaveLength(1);
  });

  it('uploading a file calls itemImagesApi.upload and triggers onChanged', async () => {
    (itemImagesApi.upload as ReturnType<typeof vi.fn>).mockResolvedValue(secondary);
    const onChanged = vi.fn();
    const { container } = render(<ItemImageGallery itemId="i1" images={[primary]} onChanged={onChanged} />);

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(itemImagesApi.upload).toHaveBeenCalledWith('i1', file);
    expect(onChanged).toHaveBeenCalled();
  });

  it('AC: deleting the primary image calls the delete endpoint (server handles promotion)', async () => {
    (itemImagesApi.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ deleted: true });
    const onChanged = vi.fn();
    render(<ItemImageGallery itemId="i1" images={[primary, secondary]} onChanged={onChanged} />);

    const deleteButtons = screen.getAllByTitle('Delete');
    await userEvent.click(deleteButtons[0]!);

    expect(itemImagesApi.delete).toHaveBeenCalledWith('i1', primary.id);
    expect(onChanged).toHaveBeenCalled();
  });

  it('clicking "Set as primary" on a non-primary image calls setPrimary', async () => {
    (itemImagesApi.setPrimary as ReturnType<typeof vi.fn>).mockResolvedValue({ ...secondary, isPrimary: true });
    const onChanged = vi.fn();
    render(<ItemImageGallery itemId="i1" images={[primary, secondary]} onChanged={onChanged} />);

    await userEvent.click(screen.getByTitle('Set as primary'));

    expect(itemImagesApi.setPrimary).toHaveBeenCalledWith('i1', secondary.id);
    expect(onChanged).toHaveBeenCalled();
  });
});

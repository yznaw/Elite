export const NO_IMAGE_LOGO = '/assets/brand/elite-logo-green.png';

export function onProductImgError(e: Event): void {
  const img = e.target as HTMLImageElement;
  if (img.src.endsWith(NO_IMAGE_LOGO)) return;
  img.src = NO_IMAGE_LOGO;
  img.classList.add('no-img');
}

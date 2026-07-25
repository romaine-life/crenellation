import { describe, expect, it } from 'vitest';
import { imageCssValue } from './catalogData';
import optimizedImages from './optimized-images.json';

describe('imageCssValue', () => {
  it('upgrades optimized PNG paths to an AVIF/WebP/PNG image-set', () => {
    const png = '/assets/ui/main-menu/background-scene-v1.png';
    const value = imageCssValue(png);
    expect(value).toBe(
      'image-set(url(/assets/ui/main-menu/background-scene-v1.avif) type("image/avif"), ' +
        'url(/assets/ui/main-menu/background-scene-v1.webp) type("image/webp"), ' +
        'url(/assets/ui/main-menu/background-scene-v1.png) type("image/png"))',
    );
  });

  it('emits a plain url() for non-optimized paths (other catalog surfaces unchanged)', () => {
    expect(imageCssValue('/assets/ui/level-editor/panel-frame.png')).toBe(
      'url(/assets/ui/level-editor/panel-frame.png)',
    );
  });

  it('strips CSS-injection characters from the url', () => {
    expect(imageCssValue('/assets/ui/x".png)evil')).toBe('url(/assets/ui/x.png)evil)');
  });

  it('returns none for an empty image url', () => {
    expect(imageCssValue('')).toBe('none');
  });

  it('every optimized target is an upgradeable .png path', () => {
    for (const target of optimizedImages.targets) {
      expect(target.path.endsWith('.png')).toBe(true);
      expect(imageCssValue(target.path)).toContain('image-set(');
    }
  });
});

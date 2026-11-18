import { Resvg } from '@resvg/resvg-js';
import type { Sprite } from './kit';

/** Renders an SVG to PNG at the given pixel width. Used by tools outside this package (tools/yandex). */
export function svgToPng(svg: string, width: number): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng());
}

/** A sprite's drawing without its outer <svg> tag, in sprite units with the origin at its top-left. */
export function spriteInner(s: Sprite): string {
  return s.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

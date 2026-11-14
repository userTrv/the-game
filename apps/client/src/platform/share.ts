import { pixi } from '../gfx/stage';
import { tg } from './telegram';

/**
 * Shares the overgrown shell. Where the Web Share API accepts files, a screenshot of the canvas
 * goes along; otherwise a link is shared (Telegram's share sheet inside the Mini App).
 */
export async function shareShell(text: string, url: string, tgUrl: string): Promise<void> {
  try {
    const canvas = pixi().canvas as HTMLCanvasElement;
    pixi().render();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    const file = blob ? new File([blob], 'shellter.png', { type: 'image/png' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text} ${url}` });
      return;
    }
  } catch {
    /* fall through to link sharing */
  }
  const app = tg();
  if (app) {
    app.openTelegramLink(tgUrl);
    return;
  }
  try {
    if (navigator.share) await navigator.share({ text, url });
    else await navigator.clipboard.writeText(`${text} ${url}`);
  } catch {
    /* the user cancelled */
  }
}

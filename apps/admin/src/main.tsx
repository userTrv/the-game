import { signal, useSignal } from '@preact/signals';
import { render, type JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles.css';

/**
 * Operator console: metrics, players, live events and broadcasts. Talks only to
 * /admin/api of the game server; the session token lives in sessionStorage (gone with the tab).
 */
const token = signal<string | null>(sessionStorage.getItem('admin_token'));
const error = signal<string | null>(null);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token.value ? { authorization: `Bearer ${token.value}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 403 && path !== '/login') {
    sessionStorage.removeItem('admin_token');
    token.value = null;
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error?.code ?? `HTTP ${res.status}`);
  return data as T;
}

/** Runs an action and shows its failure in the header instead of losing it. */
async function run<T>(fn: () => Promise<T>): Promise<T | null> {
  error.value = null;
  try {
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

function useLoad<T>(path: string, dep: unknown = null): { data: T | null; reload: () => void } {
  const data = useSignal<T | null>(null);
  const tick = useSignal(0);
  useEffect(() => {
    void run(() => call<T>('GET', path)).then((d) => (data.value = d));
  }, [path, dep, tick.value]);
  return { data: data.value, reload: () => (tick.value += 1) };
}

const date = (ms: number | null | undefined): string => (ms ? new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const toLocalInput = (ms: number): string => new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Login(): JSX.Element {
  const pass = useSignal('');
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await run(() => call<{ token: string }>('POST', '/login', { password: pass.value }));
    if (res) {
      sessionStorage.setItem('admin_token', res.token);
      token.value = res.token;
    }
  };
  return (
    <form class="card login" onSubmit={(e) => void submit(e)}>
      <h2>Shellter — админка</h2>
      <div class="row">
        <input type="password" placeholder="Пароль" autocomplete="current-password" value={pass.value} onInput={(e) => (pass.value = (e.target as HTMLInputElement).value)} style={{ flex: 1 }} />
        <button class="primary" type="submit">Войти</button>
      </div>
      {error.value ? <div class="err">{error.value}</div> : null}
    </form>
  );
}

interface Dashboard {
  dau: number;
  mau: number;
  dauSeries: { day: number; dau: number }[] | number[];
  retention: { d1: number; d7: number; d30: number };
  session: { avgSeconds: number; count: number };
  funnel: { step: string; n: number }[];
  builds: { key: string; runs: number; avgStage: number; successRate: number }[];
  battles: { hero: string; winRate: number; battles: number }[];
  revenue: { stars30d: number; purchases30d: number; payers30d: number; starsToday: number; arpdauStars: number };
  ads: { rewards30d: number; rewardsToday: number };
  players: { total: number; payers: number; conversion: number };
  suspicious7d: number;
}

function DashboardTab(): JSX.Element {
  const { data: d } = useLoad<Dashboard>('/dashboard');
  if (!d) return <div class="mute">Загрузка…</div>;
  const series = d.dauSeries.map((x) => (typeof x === 'number' ? x : x.dau));
  const top = Math.max(1, ...series);
  const kpis: [string, string | number][] = [
    ['DAU', d.dau], ['MAU', d.mau], ['Игроков всего', d.players.total],
    ['D1', pct(d.retention.d1)], ['D7', pct(d.retention.d7)], ['D30', pct(d.retention.d30)],
    ['Сессия, мин', (d.session.avgSeconds / 60).toFixed(1)], ['Stars сегодня', d.revenue.starsToday], ['Stars за 30 дн.', d.revenue.stars30d],
    ['ARPDAU, Stars', d.revenue.arpdauStars.toFixed(2)], ['Платящих', `${d.players.payers} (${pct(d.players.conversion)})`], ['Покупок за 30 дн.', d.revenue.purchases30d],
    ['Реклама сегодня', d.ads.rewardsToday], ['Реклама за 30 дн.', d.ads.rewards30d], ['Подозрительных за 7 дн.', d.suspicious7d],
  ];
  return (
    <>
      <div class="grid" style={{ marginBottom: '14px' }}>{kpis.map(([k, v]) => <div class="kpi" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      <div class="card"><h2>DAU по дням</h2><div class="bars">{series.map((v, i) => <i key={i} title={String(v)} style={{ height: `${(v / top) * 100}%` }} />)}</div></div>
      <div class="card"><h2>Воронка обучения (игроков за 30 дней)</h2>
        <div class="wrap"><table><thead><tr><th>Шаг</th><th class="num">Игроков</th></tr></thead><tbody>{d.funnel.map((s) => <tr key={s.step}><td>{s.step}</td><td class="num">{s.n}</td></tr>)}</tbody></table></div>
      </div>
      <div class="card"><h2>Билды: герой / главная диета (14 дней)</h2>
        <div class="wrap"><table><thead><tr><th>Билд</th><th class="num">Забегов</th><th class="num">Средний этап</th><th class="num">Вынос</th></tr></thead>
          <tbody>{d.builds.map((b) => <tr key={b.key}><td>{b.key}</td><td class="num">{b.runs}</td><td class="num">{b.avgStage.toFixed(1)}</td><td class="num">{pct(b.successRate)}</td></tr>)}</tbody></table></div>
      </div>
      <div class="card"><h2>Победы над стражами по героям (14 дней)</h2>
        <div class="wrap"><table><thead><tr><th>Герой</th><th class="num">Боёв</th><th class="num">Побед</th></tr></thead>
          <tbody>{d.battles.map((b) => <tr key={b.hero}><td>{b.hero}</td><td class="num">{b.battles}</td><td class="num">{pct(b.winRate)}</td></tr>)}</tbody></table></div>
      </div>
    </>
  );
}

interface PlayerRow { id: string; name: string; tgId: number | null; guest: boolean; lang: string; coral: number; shine: number; trophies: number; runs: number; bestStage: number; paidStars: number; createdAt: number; lastSeenAt: number; botBlocked: boolean }

function PlayersTab(): JSX.Element {
  const q = useSignal('');
  const applied = useSignal('');
  const open = useSignal<string | null>(null);
  const { data } = useLoad<{ players: PlayerRow[] }>(`/players?q=${encodeURIComponent(applied.value)}`);
  return (
    <>
      <form class="row" onSubmit={(e) => { e.preventDefault(); applied.value = q.value.trim(); }}>
        <input placeholder="Имя, id игрока или Telegram id" value={q.value} onInput={(e) => (q.value = (e.target as HTMLInputElement).value)} style={{ flex: 1 }} />
        <button class="primary" type="submit">Найти</button>
      </form>
      {open.value ? <PlayerCard id={open.value} onClose={() => (open.value = null)} /> : null}
      <div class="card wrap"><table>
        <thead><tr><th>Имя</th><th>Telegram</th><th class="num">Кораллы</th><th class="num">Блеск</th><th class="num">Кубки</th><th class="num">Забегов</th><th class="num">Этап</th><th class="num">Stars</th><th>Был</th><th /></tr></thead>
        <tbody>{(data?.players ?? []).map((p) => (
          <tr key={p.id}><td>{p.name}{p.guest ? <span class="mute"> · гость</span> : null}{p.botBlocked ? <span class="err"> · бот заблокирован</span> : null}</td><td>{p.tgId ?? '—'}</td><td class="num">{p.coral}</td><td class="num">{p.shine}</td><td class="num">{p.trophies}</td><td class="num">{p.runs}</td><td class="num">{p.bestStage}</td><td class="num">{p.paidStars}</td><td>{date(p.lastSeenAt)}</td><td><button onClick={() => (open.value = p.id)}>Открыть</button></td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

interface PlayerDetail { player: { id: string; name: string; profile: { coral: number; shine: number } }; tgId: number | null; paidStars: number; runs: { id: string; heroId: string; status: string; result: string | null; stage: number; startedAt: number }[]; payments: PaymentRow[] }

function PlayerCard({ id, onClose }: { id: string; onClose: () => void }): JSX.Element {
  const { data: d, reload } = useLoad<PlayerDetail>(`/players/${id}`, id);
  const coral = useSignal('0');
  const shine = useSignal('0');
  const cosmetic = useSignal('');
  const grant = async (): Promise<void> => {
    const body = { coral: Number(coral.value) || 0, shine: Number(shine.value) || 0, ...(cosmetic.value.trim() ? { cosmetic: cosmetic.value.trim() } : {}) };
    if (!window.confirm(`Выдать игроку: кораллы ${body.coral}, блеск ${body.shine}${body.cosmetic ? `, косметика ${body.cosmetic}` : ''}?`)) return;
    if (await run(() => call('POST', `/players/${id}/grant`, body))) reload();
  };
  if (!d) return <div class="card mute">Загрузка…</div>;
  return (
    <div class="card">
      <div class="row"><h2 style={{ margin: 0, flex: 1 }}>{d.player.name} <span class="mute">{d.player.id}</span></h2><button onClick={onClose}>Закрыть</button></div>
      <div class="row mute">Telegram: {d.tgId ?? '—'} · кораллы {d.player.profile.coral} · блеск {d.player.profile.shine} · оплачено Stars: {d.paidStars}</div>
      <div class="row">
        <label>Кораллы <input type="number" value={coral.value} onInput={(e) => (coral.value = (e.target as HTMLInputElement).value)} style={{ width: '90px' }} /></label>
        <label>Блеск <input type="number" value={shine.value} onInput={(e) => (shine.value = (e.target as HTMLInputElement).value)} style={{ width: '90px' }} /></label>
        <input placeholder="id косметики" value={cosmetic.value} onInput={(e) => (cosmetic.value = (e.target as HTMLInputElement).value)} />
        <button onClick={() => void grant()}>Выдать</button>
      </div>
      <h2>Последние забеги</h2>
      <div class="wrap"><table><thead><tr><th>Начат</th><th>Герой</th><th>Статус</th><th>Итог</th><th class="num">Этап</th></tr></thead>
        <tbody>{d.runs.map((r) => <tr key={r.id}><td>{date(r.startedAt)}</td><td>{r.heroId}</td><td>{r.status}</td><td>{r.result ?? '—'}</td><td class="num">{r.stage}</td></tr>)}</tbody></table></div>
      {d.payments.length > 0 ? <><h2 style={{ marginTop: '12px' }}>Платежи</h2><PaymentsTable rows={d.payments} /></> : null}
    </div>
  );
}

interface PaymentRow { id: string; playerId: string; productId: string; stars: number; status: string; createdAt: number; paidAt: number | null; refundedAt: number | null }

/** Stars payments made before the shop was removed; kept read-only for history. */
function PaymentsTable({ rows }: { rows: PaymentRow[] }): JSX.Element {
  return (
    <div class="wrap"><table>
      <thead><tr><th>Оплачен</th><th>Товар</th><th class="num">Stars</th><th>Статус</th><th>Игрок</th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id}><td>{date(p.paidAt ?? p.createdAt)}</td><td>{p.productId}</td><td class="num">{p.stars}</td><td class={p.status === 'refunded' ? 'err' : p.status === 'paid' ? 'ok' : 'mute'}>{p.status}</td><td class="mute">{p.playerId}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function PaymentsTab(): JSX.Element {
  const { data } = useLoad<{ payments: PaymentRow[] }>('/payments');
  return <div class="card"><h2>Платежи Stars (архив)</h2><PaymentsTable rows={data?.payments ?? []} /></div>;
}

interface LiveRow { id: string; kind: 'event' | 'kraken' | 'season'; config: Record<string, unknown>; startsAt: number; endsAt: number; finalized: boolean }

function LiveTab(): JSX.Element {
  const { data, reload } = useLoad<{ items: LiveRow[] }>('/live');
  const kind = useSignal<LiveRow['kind']>('event');
  const json = useSignal('');
  const now = Date.now();
  const edit = (row: LiveRow): void => {
    kind.value = row.kind;
    json.value = JSON.stringify(row.config, null, 2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = async (): Promise<void> => {
    let config: unknown;
    try {
      config = JSON.parse(json.value);
    } catch {
      error.value = 'Конфиг — не JSON';
      return;
    }
    if (await run(() => call('POST', '/live', { kind: kind.value, config }))) reload();
  };
  const remove = async (row: LiveRow): Promise<void> => {
    if (!window.confirm(`Удалить «${row.id}»? Очки участников останутся в базе, но событие пропадёт из игры.`)) return;
    if (await run(() => call('DELETE', `/live/${row.id}`))) reload();
  };
  return (
    <>
      <div class="card">
        <h2>Создать или изменить</h2>
        <div class="row">
          <select value={kind.value} onChange={(e) => (kind.value = (e.target as HTMLSelectElement).value as LiveRow['kind'])}>
            <option value="event">Событие недели</option><option value="kraken">Кракен</option><option value="season">Сезон</option>
          </select>
          <span class="mute">Конфиг целиком в JSON; обязательны id, startsAt, endsAt (миллисекунды). Запись с тем же id заменяется. Сейчас: {now}</span>
        </div>
        <textarea value={json.value} placeholder='Нажми «Изменить» у записи ниже, чтобы взять её конфиг за основу' onInput={(e) => (json.value = (e.target as HTMLTextAreaElement).value)} />
        <div class="row" style={{ marginTop: '8px' }}><button class="primary" disabled={!json.value.trim()} onClick={() => void save()}>Сохранить</button></div>
      </div>
      <div class="card wrap"><table>
        <thead><tr><th>id</th><th>Тип</th><th>Начало</th><th>Конец</th><th>Состояние</th><th /></tr></thead>
        <tbody>{(data?.items ?? []).map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.kind}</td><td>{date(r.startsAt)}</td><td>{date(r.endsAt)}</td>
            <td>{r.finalized ? 'итоги подведены' : now < r.startsAt ? 'ждёт' : now < r.endsAt ? <span class="ok">идёт</span> : 'закончилось'}</td>
            <td><button onClick={() => edit(r)}>Изменить</button> <button class="danger" onClick={() => void remove(r)}>Удалить</button></td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

interface BroadcastRow { id: string; segment: { kind: string; days?: number; eventId?: string }; text: { ru: string; en: string }; scheduledAt: number; status: string; total: number; report: Record<string, number> }

function BroadcastsTab(): JSX.Element {
  const { data, reload } = useLoad<{ broadcasts: BroadcastRow[] }>('/broadcasts');
  const seg = useSignal('all');
  const days = useSignal('7');
  const eventId = useSignal('');
  const ru = useSignal('');
  const en = useSignal('');
  const btnText = useSignal('');
  const btnUrl = useSignal('');
  const when = useSignal(toLocalInput(Date.now()));
  const preview = useSignal<number | null>(null);
  const body = (): Record<string, unknown> => ({
    segment: { kind: seg.value, ...(seg.value === 'inactive' ? { days: Number(days.value) || 7 } : {}), ...(seg.value === 'event' ? { eventId: eventId.value.trim() } : {}) },
    text: { ru: ru.value, en: en.value },
    button: btnText.value.trim() && btnUrl.value.trim() ? { text: btnText.value.trim(), kind: 'webapp', url: btnUrl.value.trim() } : null,
    scheduledAt: Math.max(Date.now(), new Date(when.value).getTime() || Date.now()),
  });
  const check = async (): Promise<void> => {
    const res = await run(() => call<{ recipients: number }>('POST', '/broadcasts/preview', body()));
    preview.value = res ? res.recipients : null;
  };
  const send = async (): Promise<void> => {
    if (preview.value === null) return;
    if (!window.confirm(`Отправить рассылку ${preview.value} получателям?`)) return;
    if (await run(() => call('POST', '/broadcasts', body()))) {
      preview.value = null;
      reload();
    }
  };
  const cancel = async (id: string): Promise<void> => {
    if (await run(() => call('POST', `/broadcasts/${id}/cancel`, {}))) reload();
  };
  const dirty = (): void => {
    preview.value = null;
  };
  return (
    <>
      <div class="card" onInput={dirty}>
        <h2>Новая рассылка</h2>
        <div class="row">
          <select value={seg.value} onChange={(e) => { seg.value = (e.target as HTMLSelectElement).value; dirty(); }}>
            <option value="all">Все, кто запускал бота</option><option value="inactive">Не заходили N дней</option><option value="event">Участники события</option><option value="payers">Покупатели</option>
          </select>
          {seg.value === 'inactive' ? <label>Дней <input type="number" min="1" max="365" value={days.value} onInput={(e) => (days.value = (e.target as HTMLInputElement).value)} style={{ width: '70px' }} /></label> : null}
          {seg.value === 'event' ? <input placeholder="id события" value={eventId.value} onInput={(e) => (eventId.value = (e.target as HTMLInputElement).value)} /> : null}
          <label>Когда <input type="datetime-local" value={when.value} onInput={(e) => (when.value = (e.target as HTMLInputElement).value)} /></label>
        </div>
        <div class="row"><textarea placeholder="Текст на русском (HTML Telegram)" value={ru.value} onInput={(e) => (ru.value = (e.target as HTMLTextAreaElement).value)} /></div>
        <div class="row"><textarea placeholder="Text in English" value={en.value} onInput={(e) => (en.value = (e.target as HTMLTextAreaElement).value)} /></div>
        <div class="row">
          <input placeholder="Текст кнопки (необязательно)" value={btnText.value} onInput={(e) => (btnText.value = (e.target as HTMLInputElement).value)} />
          <input placeholder="https://… адрес Mini App" value={btnUrl.value} onInput={(e) => (btnUrl.value = (e.target as HTMLInputElement).value)} style={{ flex: 1 }} />
        </div>
        <div class="row">
          <button disabled={!ru.value.trim() && !en.value.trim()} onClick={() => void check()}>Посчитать получателей</button>
          {preview.value !== null ? <><span>Получателей: <b>{preview.value}</b></span><button class="primary" disabled={preview.value === 0} onClick={() => void send()}>Отправить</button></> : <span class="mute">Отправка доступна после подсчёта</span>}
        </div>
      </div>
      <div class="card wrap"><table>
        <thead><tr><th>Время</th><th>Сегмент</th><th>Текст</th><th>Статус</th><th class="num">Всего</th><th>Доставка</th><th /></tr></thead>
        <tbody>{(data?.broadcasts ?? []).map((b) => (
          <tr key={b.id}><td>{date(b.scheduledAt)}</td><td>{b.segment.kind}{b.segment.days ? ` ${b.segment.days} дн.` : ''}{b.segment.eventId ? ` ${b.segment.eventId}` : ''}</td>
            <td title={b.text.ru || b.text.en}>{(b.text.ru || b.text.en).slice(0, 50)}</td><td>{b.status}</td><td class="num">{b.total}</td>
            <td>{Object.entries(b.report).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
            <td>{b.status === 'scheduled' ? <button class="danger" onClick={() => void cancel(b.id)}>Отменить</button> : null}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

const TABS = [
  ['dashboard', 'Метрики', DashboardTab],
  ['players', 'Игроки', PlayersTab],
  ['live', 'События', LiveTab],
  ['broadcasts', 'Рассылки', BroadcastsTab],
  ['payments', 'Платежи', PaymentsTab],
] as const;

function App(): JSX.Element {
  const tab = useSignal<string>(location.hash.slice(1) || 'dashboard');
  if (!token.value) return <Login />;
  const Tab = (TABS.find((t) => t[0] === tab.value) ?? TABS[0])[2];
  return (
    <>
      <header>
        <b>Shellter</b>
        {TABS.map(([id, title]) => <button key={id} class={tab.value === id ? 'on' : ''} onClick={() => { tab.value = id; location.hash = id; error.value = null; }}>{title}</button>)}
        <span style={{ flex: 1 }} />
        {error.value ? <span class="err">{error.value}</span> : null}
        <button onClick={() => { sessionStorage.removeItem('admin_token'); token.value = null; }}>Выйти</button>
      </header>
      <main><Tab /></main>
    </>
  );
}

render(<App />, document.getElementById('app') as HTMLElement);

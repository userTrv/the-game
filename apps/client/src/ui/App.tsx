import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { hunt } from '../director';
import { t } from '../i18n';
import { setBackButton } from '../platform/telegram';
import { bootError, busy, loadProgress, panel, screen, toast } from '../state';
import { AlmanacSheet, BuildingSheet, HeroesSheet, HomeView, TalentsSheet } from './Home';
import { Bar, Btn, Spr } from './kit';
import { EventsSheet, InboxSheet, QuestsSheet, SettingsSheet, ShopSheet } from './Panels';
import { BattleView, CampView, DownView, HuntHudView, ResultView } from './RunScreens';

function Boot(): JSX.Element {
  return (
    <div class="boot" id="boot">
      <div class="logo"><Spr id="ui/logo" size={130} /></div>
      <div class="title" style={{ fontSize: '34px' }}>Shellter</div>
      {bootError.value ? (
        <>
          <div class="muted center" style={{ maxWidth: '260px' }}>{bootError.value}</div>
          <Btn class="go" onClick={() => location.reload()}>{t('common.retry')}</Btn>
        </>
      ) : (
        <>
          <div class="track"><Bar value={loadProgress.value} max={1} kind="xp" /></div>
          <div class="muted">{t('loading')}</div>
        </>
      )}
    </div>
  );
}

function PanelView(): JSX.Element | null {
  const p = panel.value;
  if (p === null) return null;
  if (typeof p === 'object') return <BuildingSheet id={p.building} />;
  switch (p) {
    case 'quests':
      return <QuestsSheet />;
    case 'events':
      return <EventsSheet />;
    case 'shop':
      return <ShopSheet />;
    case 'settings':
      return <SettingsSheet />;
    case 'inbox':
      return <InboxSheet />;
    case 'almanac':
      return <AlmanacSheet />;
    case 'heroes':
      return <HeroesSheet />;
    case 'talents':
      return <TalentsSheet />;
  }
}

export function App(): JSX.Element {
  const s = screen.value;
  const p = panel.value;
  useEffect(() => {
    // Telegram's BackButton closes the open panel; closing a panel resumes a paused pool.
    setBackButton(p !== null ? () => (panel.value = null) : null);
    if (p === null) hunt()?.setPaused(false);
  }, [p]);
  return (
    <>
      {s === 'boot' ? <Boot /> : null}
      {s === 'home' ? <HomeView /> : null}
      {s === 'hunt' ? <HuntHudView /> : null}
      {s === 'camp' ? <CampView /> : null}
      {s === 'battle' ? <BattleView /> : null}
      {s === 'down' ? <DownView /> : null}
      {s === 'result' ? <ResultView /> : null}
      <PanelView />
      {busy.value ? <div class="busy" /> : null}
      {toast.value ? <div class="toast" key={toast.value.id}>{toast.value.text}</div> : null}
    </>
  );
}

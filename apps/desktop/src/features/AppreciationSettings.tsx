import { Music2 } from 'lucide-react';
import { DropdownSelect } from '../components/DropdownSelect';
import { t } from '../lib/i18n';
import type { MusicSource, useAppreciationSettings } from './use-appreciation-settings';

export function AppreciationSettings({ settings, disabled }: { settings: ReturnType<typeof useAppreciationSettings>; disabled: boolean }) {
  const { preferences, musicSource, localMusic, analysis, picking, change, changeMusic, chooseMusic, clearLocalMusic } = settings;
  const musicOptions: { value: MusicSource; label: string; disabled?: boolean }[] = [
    { value: 'builtin', label: t('内置音乐', 'Built-in Music') },
    { value: 'local', label: t('本地音乐', 'Local Music'), disabled: !localMusic.length },
    { value: 'off', label: t('无配乐', 'No Music') },
  ];
  const pending = localMusic.filter(track => !analysis.has(track.id)).length;
  const fixed = localMusic.filter(track => analysis.get(track.id)?.status === 'fixed').length;
  return <section className="settings-content settings-appreciation" aria-labelledby="settings-appreciation-title">
    <h2 id="settings-appreciation-title">{t('欣赏', 'Slideshow')}</h2>
    <div className="settings-appreciation-layout">
      <div className="settings-appreciation-column" role="group" aria-label={t('播放', 'Playback')}>
        <DropdownSelect label={t('播放顺序', 'Playback Order')} field value={preferences.random ? 'random' : 'ordered'}
          options={[{ value: 'ordered', label: t('顺序', 'In Order') }, { value: 'random', label: t('乱序', 'Shuffle') }]}
          disabled={disabled} onChange={(order) => change({ random: order === 'random' })} />
        <div className="settings-appreciation-toggles">
          <label><input type="checkbox" checked={preferences.loop} disabled={disabled} onChange={(event) => change({ loop: event.currentTarget.checked })} />{t('照片循环', 'Repeat Photos')}</label>
          <label><input type="checkbox" checked={preferences.groupPortraits} disabled={disabled} onChange={(event) => change({ groupPortraits: event.currentTarget.checked })} />{t('竖幅组图', 'Group Portrait Photos')}</label>
          <label><input type="checkbox" checked={preferences.preferFill} disabled={disabled} onChange={(event) => change({ preferFill: event.currentTarget.checked })} />{t('贴屏优先', 'Prefer Screen Fill')}</label>
        </div>
      </div>
      <div className="settings-appreciation-column" role="group" aria-label={t('声音', 'Sound')}>
        <div className="settings-appreciation-music">
          <DropdownSelect label={t('配乐', 'Music')} field value={musicSource} options={musicOptions}
            disabled={disabled || picking} onChange={changeMusic} />
          <button type="button" className="button" disabled={disabled || picking} onClick={() => void chooseMusic()}><Music2 size={14} />{picking ? t('正在添加…', 'Adding…') : t('添加本地音乐', 'Add Local Music')}</button>
        </div>
        {localMusic.length > 0 && <div className="settings-appreciation-local">
          <span className="muted">{t(`${localMusic.length} 首本地音乐`, `${localMusic.length} local tracks`)}</span>
          <button type="button" className="text-button" aria-label={t('清空本地音乐', 'Clear Local Music')} disabled={disabled || picking} onClick={clearLocalMusic}>{t('清空', 'Clear')}</button>
        </div>}
        {musicSource === 'local' && (pending > 0 || fixed > 0) && <p className="muted settings-appreciation-status" role="status">{pending > 0
          ? t(`正在分析 ${pending} 首配乐节拍…`, `Analyzing beats for ${pending} tracks…`)
          : t(`${fixed} 首配乐无法同步鼓点，按默认间隔切换。`, `Beat sync is unavailable for ${fixed} tracks. Scenes use the default interval.`)}</p>}
      </div>
    </div>
  </section>;
}

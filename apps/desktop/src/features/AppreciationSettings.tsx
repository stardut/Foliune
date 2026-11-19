import { Music2 } from 'lucide-react';
import { DropdownSelect } from '../components/DropdownSelect';
import { t } from '../lib/i18n';
import { appreciationIntervals } from '../lib/appreciation-preferences';
import { BUILTIN_MUSIC } from '../lib/player-music';
import type { useAppreciationSettings } from './use-appreciation-settings';

export function AppreciationSettings({ settings, disabled }: { settings: ReturnType<typeof useAppreciationSettings>; disabled: boolean }) {
  const { preferences, music, localMusic, analysis, picking, change, changeMusic, chooseMusic } = settings;
  const musicOptions = [
    ...BUILTIN_MUSIC.map((track) => ({ value: track.id, label: t(track.name, track.nameEn) })),
    ...(localMusic ? [{ value: localMusic.id, label: localMusic.name }] : []),
    { value: 'off', label: t('无配乐', 'No Music') },
  ];
  return <section className="settings-content settings-appreciation" aria-labelledby="settings-appreciation-title">
    <h2 id="settings-appreciation-title">{t('欣赏', 'Slideshow')}</h2>
    <div className="settings-appreciation-fields">
      <DropdownSelect label={t('每组停留', 'Time per Scene')} field value={preferences.seconds}
        options={appreciationIntervals.map((value) => ({ value, label: t(`${value} 秒`, `${value} sec`) }))}
        disabled={disabled} onChange={(seconds) => change({ seconds })} />
      <DropdownSelect label={t('播放顺序', 'Playback Order')} field value={preferences.random ? 'random' : 'ordered'}
        options={[{ value: 'ordered', label: t('顺序', 'In Order') }, { value: 'random', label: t('乱序', 'Shuffle') }]}
        disabled={disabled} onChange={(order) => change({ random: order === 'random' })} />
      <DropdownSelect label={t('配乐', 'Music')} field value={music?.id ?? 'off'} options={musicOptions}
        disabled={disabled || picking} onChange={changeMusic} />
      <label className="settings-appreciation-volume">{t('音乐音量', 'Music Volume')}
        <span><input aria-label={t('音乐音量', 'Music Volume')} type="range" min="0" max="1" step=".05"
          value={preferences.volume} disabled={disabled || !music} onChange={(event) => change({ volume: Number(event.target.value) })} />
          <output>{Math.round(preferences.volume * 100)}%</output></span>
      </label>
    </div>
    <div className="settings-appreciation-actions">
      <label><input type="checkbox" checked={preferences.loop} disabled={disabled} onChange={(event) => change({ loop: event.currentTarget.checked })} />{t('循环播放', 'Repeat')}</label>
      <button type="button" className="button" disabled={disabled || picking} onClick={() => void chooseMusic()}><Music2 size={14} />{picking ? t('正在选择…', 'Choosing…') : t('选择本地音乐', 'Choose Local Music')}</button>
    </div>
    {localMusic && analysis?.status !== 'ready' && <p className="muted" role="status">{analysis
      ? t('这首配乐无法同步鼓点，按设定时间切换。', 'Beat sync is unavailable for this track. Scenes use the selected timing.')
      : t('正在分析配乐节拍…', 'Analyzing music beats…')}</p>}
  </section>;
}

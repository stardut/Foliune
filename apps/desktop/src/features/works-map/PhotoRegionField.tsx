import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useDismiss } from '../../components/beui/hooks/use-dismiss';
import { revealDropdownRow } from '../../components/dropdown-layer';
import { IconButton } from '../../components/ui';
import { getLocale, t } from '../../lib/i18n';
import { loadWorksMapRegionData, type WorksMapRegion, type WorksMapRegionData } from './works-map-regions';
import './photo-region-field.css';

function searchText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase(getLocale());
}

function regionLabel(region: WorksMapRegion) {
  return region.country && region.country !== region.name ? `${region.name} · ${region.country}` : region.name;
}

export function PhotoRegionField({ value, readOnly, disabled, onChange }: {
  value: string;
  readOnly: boolean;
  disabled: boolean;
  onChange: (regionId: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [data, setData] = useState<WorksMapRegionData | 'failed'>();
  const editing = open && !readOnly && !disabled;
  const wantsData = editing || !!value;
  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0); }, []);
  useDismiss(editing, close, field, { escape: false });
  useEffect(() => { if (readOnly || disabled) close(); }, [close, disabled, readOnly]);
  useEffect(() => {
    if (!wantsData || data) return;
    let mounted = true;
    void loadWorksMapRegionData(getLocale()).then((regions) => {
      if (mounted) setData(regions);
    }, () => { if (mounted) setData('failed'); });
    return () => { mounted = false; };
  }, [data, wantsData]);

  const index = useMemo(() => data && data !== 'failed' ? data.regions.map((region) => ({
    region, name: searchText(region.name), text: searchText(`${region.name} ${region.country}`),
  })) : [], [data]);
  const normalized = searchText(query);
  const matches = useMemo(() => {
    if (!normalized) return [];
    const terms = normalized.split(/\s+/u);
    return index.filter(({ text }) => terms.every((term) => text.includes(term)))
      .sort((a, b) => matchRank(a.name, normalized) - matchRank(b.name, normalized)
        || a.region.name.localeCompare(b.region.name, getLocale()) || a.region.country.localeCompare(b.region.country, getLocale()))
      .slice(0, 12);
  }, [index, normalized]);

  const selected = value && data && data !== 'failed' ? data.regionById(value) : undefined;
  const selectedLabel = selected ? regionLabel(selected) : '';
  const activeOption = editing && matches[active];
  const optionId = `${id}-${active}`;
  const status = data === 'failed' ? t('无法读取离线地区', 'Could not load offline regions')
    : !data && wantsData ? t('正在读取拍摄地区…', 'Loading shooting regions…')
    : editing && normalized && !matches.length ? t('没有匹配的地区', 'No matching regions')
    : value && !selected && data ? t('已保存的地区不可用', 'The saved region is unavailable') : '';
  const showStatus = !!status && (editing || (!!value && !selected));
  useLayoutEffect(() => {
    if (!activeOption || !panel.current) return;
    const row = document.getElementById(optionId);
    if (row) revealDropdownRow(panel.current, row);
  }, [activeOption, optionId]);

  function choose(regionId: string) {
    onChange(regionId);
    close();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly || disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) choose(activeOption.region.id);
      else setOpen(true);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (matches.length) setActive((current) => Math.min(matches.length - 1, Math.max(0, current + (event.key === 'ArrowUp' ? -1 : 1))));
    }
  }

  const label = t('拍摄地区', 'Shooting Region');
  const placeholder = t('搜索省、州或国家', 'Search by region or country');
  return <div ref={field} className="photo-region-field" onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="photo-region-control">
      <input id={id} ref={input} readOnly={readOnly} disabled={disabled} role={readOnly ? undefined : 'combobox'}
        aria-autocomplete={readOnly ? undefined : 'list'} aria-expanded={readOnly ? undefined : editing && matches.length > 0}
        aria-controls={editing && matches.length ? `${id}-list` : undefined} aria-activedescendant={activeOption ? optionId : undefined}
        aria-describedby={showStatus ? `${id}-status` : readOnly ? `${id}-gps` : undefined}
        autoComplete="off" spellCheck={false} title={selectedLabel || undefined}
        placeholder={readOnly ? undefined : selectedLabel || placeholder} value={editing ? query : selectedLabel}
        onFocus={() => { if (!readOnly && !disabled) setOpen(true); }} onClick={() => { if (!readOnly && !disabled) setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={keyDown} />
      {!readOnly && value && <IconButton label={t('清除拍摄地区', 'Clear Shooting Region')} disabled={disabled}
        onClick={() => { input.current?.focus({ preventScroll: true }); choose(''); }}><X size={15} aria-hidden="true" /></IconButton>}
    </div>
    {editing && matches.length > 0 && <div id={`${id}-list`} role="listbox" aria-label={label} ref={panel} className="photo-region-options">
      {matches.map(({ region }, option) => <div key={region.id} id={`${id}-${option}`} role="option"
        className="dropdown-row" aria-selected={region.id === value} data-active={option === active || undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(region.id)}>
        <span className="photo-region-option-name">{region.name}</span>{region.country !== region.name && <small>{region.country}</small>}
      </div>)}
    </div>}
    {showStatus && <small id={`${id}-status`} className="muted" role="status">{status}</small>}
    {readOnly && <small id={`${id}-gps`} className="muted">{t('地图优先使用精确坐标', 'The map uses the exact coordinates')}</small>}
  </div>;
}

function matchRank(name: string, query: string) {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return name.includes(query) ? 2 : 3;
}

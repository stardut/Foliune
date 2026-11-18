import { t } from '../lib/i18n.ts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { daysInMonth, formatDateParts, localDateParts, parseDateParts, type DateParts } from '../lib/date-picker';
import { WheelPicker } from './beui/wheel-picker';
import { Modal } from './ui';
import './date-picker.css';

export function DatePickerField({ label, value, onChange, name, errorId, disabled, withTime = false }: {
  label: string; value: string; onChange: (value: string) => void; name?: string; errorId?: string; disabled?: boolean; withTime?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = value.replace('T', ' ');
  const close = () => setOpen(false);
  return <div className="date-picker-field">
    <label htmlFor={id}>{label}</label>
    <button id={id} type="button" name={name} className="date-picker-trigger" disabled={disabled}
      aria-label={t(`${label}：${text || '未设置'}`, `${label}: ${text || 'Not set'}`)} aria-haspopup="dialog" aria-expanded={open}
      aria-invalid={errorId ? true : undefined} aria-describedby={errorId}
      onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}>
      {value ? <time dateTime={value}>{text}</time> : <span className="date-picker-placeholder">{withTime ? t('未设置', 'Not set') : t('选择日期', 'Choose date')}</span>}
      <CalendarDays size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<DatePickerDialog title={t(`选择${label}`, `Choose ${label}`)} value={value} withTime={withTime} onClose={close}
      onSelect={(next) => { onChange(next); close(); }} />, document.body)}
  </div>;
}

function DatePickerDialog({ title, value, withTime, onClose, onSelect }: {
  title: string; value: string; withTime: boolean; onClose: () => void; onSelect: (value: string) => void;
}) {
  const [parts, setParts] = useState(() => parseDateParts(value, withTime) ?? localDateParts(new Date()));
  const [text, setText] = useState(() => formatDateParts(parts, withTime).replace('T', ' '));
  const [invalid, setInvalid] = useState(false);
  const currentParts = useRef(parts);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  function updateParts(next: DateParts) {
    currentParts.current = next;
    setParts(next);
  }

  function changePart(part: keyof DateParts, next: number) {
    const changed = { ...currentParts.current, [part]: next };
    changed.day = Math.min(changed.day, daysInMonth(changed.year, changed.month));
    updateParts(changed);
    setText(formatDateParts(changed, withTime).replace('T', ' '));
    setInvalid(false);
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const next = parseDateParts(text, withTime);
    if (next) onSelect(formatDateParts(next, withTime));
    else {
      setInvalid(true);
      input.current?.focus();
    }
  }

  return <Modal title={title}>
    <form className="date-picker-dialog" onSubmit={confirm} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <input ref={input} aria-label={withTime ? t('日期和时间', 'Date and time') : t('日期', 'Date')} className="date-picker-value" value={text}
        placeholder={withTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = parseDateParts(next, withTime);
          if (parsed) updateParts(parsed);
          setInvalid(false);
        }} />
      {invalid && <p id={errorId} className="form-error" role="alert">{withTime ? t('请输入有效的日期和时间（YYYY-MM-DD HH:mm:ss）。', 'Enter a valid date and time (YYYY-MM-DD HH:mm:ss).') : t('请输入有效的日期（YYYY-MM-DD）。', 'Enter a valid date (YYYY-MM-DD).')}</p>}
      <div className="date-picker-wheels" role="group" aria-label={t('日期', 'Date')}>
        <WheelPicker label={t('年', 'Year')} min={1} max={9999} value={parts.year} onValueChange={(next) => changePart('year', next)} />
        <WheelPicker label={t('月', 'Month')} min={1} max={12} value={parts.month} onValueChange={(next) => changePart('month', next)} />
        <WheelPicker label={t('日', 'Day')} min={1} max={daysInMonth(parts.year, parts.month)} value={parts.day} onValueChange={(next) => changePart('day', next)} />
      </div>
      {withTime && <div className="date-picker-wheels" role="group" aria-label={t('时间', 'Time')}>
        <WheelPicker label={t('时', 'Hour')} min={0} max={23} value={parts.hour} onValueChange={(next) => changePart('hour', next)} />
        <WheelPicker label={t('分', 'Minute')} min={0} max={59} value={parts.minute} onValueChange={(next) => changePart('minute', next)} />
        <WheelPicker label={t('秒', 'Second')} min={0} max={59} value={parts.second} onValueChange={(next) => changePart('second', next)} />
      </div>}
      <div className="form-actions">
        {withTime && value && <button type="button" className="button date-picker-clear" onClick={() => onSelect('')}>{t('清除', 'Clear')}</button>}
        <button type="button" className="button" onClick={onClose}>{t('取消', 'Cancel')}</button>
        <button type="submit" className="button button-primary">{t('确定', 'Done')}</button>
      </div>
    </form>
  </Modal>;
}

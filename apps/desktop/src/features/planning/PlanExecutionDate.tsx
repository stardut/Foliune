import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, Modal } from '../../components/ui';

export function PlanExecutionDate({ value, disabled, errorId, onChange }: {
  value: string; disabled: boolean; errorId?: string; onChange: (value: string) => void;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);

  return <div className="plan-field plan-date-field">
    <label htmlFor={inputId}>执行日期</label>
    <div className="plan-date-control">
      <input id={inputId} type="date" name="executionDate" required min="0001-01-01" max="9999-12-31" value={value}
        aria-invalid={errorId ? true : undefined} aria-describedby={errorId} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="icon-button" aria-label="选择执行日期" title="选择执行日期" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
        onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}><CalendarDays size={17} aria-hidden="true" /></button>
    </div>
    {open && <ExecutionCalendar value={value.length === 10 ? value : ''} onClose={() => setOpen(false)} onSelect={(date) => { onChange(date); setOpen(false); }} />}
  </div>;
}

function utcCalendarDate(year: number, month: number, day = 1) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

function ExecutionCalendar({ value, onSelect, onClose }: { value: string; onSelect: (value: string) => void; onClose: () => void }) {
  const [today] = useState(() => {
    const now = new Date();
    return utcCalendarDate(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  });
  const [monthStart, setMonthStart] = useState(() => {
    const [year, month] = (value || today).split('-').map(Number);
    return utcCalendarDate(year, month - 1);
  });
  const initialDay = useRef<HTMLButtonElement>(null);
  useEffect(() => { initialDay.current?.focus(); }, []);

  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const leadingDays = (monthStart.getUTCDay() + 6) % 7;
  const daysInMonth = utcCalendarDate(year, month + 1, 0).getUTCDate();
  const monthPrefix = monthStart.toISOString().slice(0, 7);

  return <Modal title="选择执行日期" onClose={onClose}>
    <div className="plan-calendar">
      <div className="plan-calendar-toolbar">
        <IconButton label="上个月" disabled={year === 1 && month === 0} onClick={() => setMonthStart(utcCalendarDate(year, month - 1))}><ChevronLeft size={17} /></IconButton>
        <span className="plan-calendar-month" aria-live="polite">{year} 年 {month + 1} 月</span>
        <IconButton label="下个月" disabled={year === 9999 && month === 11} onClick={() => setMonthStart(utcCalendarDate(year, month + 1))}><ChevronRight size={17} /></IconButton>
      </div>
      <div className="plan-calendar-grid">
        {weekdays.map((day) => <span key={day} className="plan-calendar-weekday" aria-hidden="true">{day}</span>)}
        {Array.from({ length: leadingDays }, (_, index) => <span key={index} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = `${monthPrefix}-${String(day).padStart(2, '0')}`;
          return <button key={date} type="button" className="plan-calendar-day" aria-label={`${year}年${month + 1}月${day}日`}
            aria-current={date === today ? 'date' : undefined} aria-pressed={date === value}
            ref={date === (value || today) ? initialDay : undefined} onClick={() => onSelect(date)}>{day}</button>;
        })}
      </div>
    </div>
  </Modal>;
}

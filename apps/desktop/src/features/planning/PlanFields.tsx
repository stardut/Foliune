import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { PLAN_MAX_TEXT } from '../../lib/planning-types';
import { IconButton } from '../../components/ui';

export function PlanTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    let width = node.clientWidth;
    function fit() { if (node) { node.style.height = 'auto'; node.style.height = `${node.scrollHeight + 2}px`; } }
    fit();
    const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; fit(); } });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={input} />;
}

export function PlanField({ label, value, onChange, rows = 1, maxLength = PLAN_MAX_TEXT, placeholder }: {
  label: string; value: string; onChange?: (value: string) => void; rows?: number; maxLength?: number; placeholder?: string;
}) {
  if (!onChange) return value.trim() ? <div className="plan-copy"><h3>{label}</h3><p>{value}</p></div> : null;
  return <label className="plan-field"><span>{label}</span><PlanTextarea rows={rows} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}
export function PlanOrder({ label, index, length, disabled, move, remove }: {
  label: string; index: number; length: number; disabled: boolean; move: (offset: number) => void; remove: () => void;
}) {
  return <div className="plan-order"><IconButton label={`前移${label}`} disabled={disabled || index === 0} onClick={() => move(-1)}><ArrowUp size={14} /></IconButton><IconButton label={`后移${label}`} disabled={disabled || index === length - 1} onClick={() => move(1)}><ArrowDown size={14} /></IconButton><IconButton label={`删除${label}`} disabled={disabled} onClick={remove}><Trash2 size={14} /></IconButton></div>;
}

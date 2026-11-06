import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownLayer, revealDropdownRow, stepDropdownIndex, useDropdown } from './dropdown-layer';

type SelectValue = string | number;
type SelectOption<Value extends SelectValue> = { value: Value; label: string; disabled?: boolean };

export function DropdownSelect<Value extends SelectValue>({ label, field = false, value, options, disabled = false, onChange }: {
  label: string;
  field?: boolean;
  value: Value;
  options: readonly SelectOption<Value>[];
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  const unavailable = disabled || !options.length;
  const { id, trigger, panel, open, setOpen, close, closeAndFocus, onBlur } = useDropdown(unavailable);
  const [active, setActive] = useState(-1);
  const search = useRef({ text: '', time: 0 });
  const selected = options.findIndex((option) => option.value === value);
  const activeId = `${id}-${active}`;

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const row = document.getElementById(activeId);
    if (row) revealDropdownRow(panel.current, row);
  }, [activeId, open, panel]);

  function show(direction: 1 | -1 = 1) {
    search.current = { text: '', time: 0 };
    const next = selected >= 0 && !options[selected].disabled ? selected : stepDropdownIndex(options, direction === 1 ? -1 : options.length, direction);
    setActive(next);
    trigger.current?.focus({ preventScroll: true });
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    closeAndFocus();
    if (value !== option.value) onChange(option.value);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (key === 'Tab') { close(); return; }
    if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        if (open) choose(active);
        else show();
      }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1;
      if (!open) show(direction);
      const start = key === 'Home' || key === 'End' || active === -1 ? (direction === 1 ? -1 : options.length) : active;
      if (open || key === 'Home' || key === 'End') {
        const next = stepDropdownIndex(options, start, direction);
        if (next >= 0) setActive(next);
      }
      return;
    }
    if (key.length !== 1) return;
    event.preventDefault();
    if (!open) show();
    const now = Date.now();
    const letter = key.toLocaleLowerCase();
    const previous = now - search.current.time < 500 ? search.current.text : '';
    const cycle = previous === letter;
    const query = cycle ? letter : previous + letter;
    search.current = { text: query, time: now };
    const start = (open ? active : selected) + (previous && !cycle ? 0 : 1);
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset + options.length) % options.length;
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query)) {
        setActive(index);
        break;
      }
    }
  }

  const control = <button type="button" className="dropdown-select" ref={trigger} role="combobox" disabled={unavailable}
    aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
    aria-activedescendant={open && active >= 0 ? activeId : undefined} onKeyDown={onKeyDown} onBlur={onBlur}
    onClick={() => { if (open) closeAndFocus(); else show(); }}>
    <span>{options[selected]?.label ?? ''}</span><ChevronDown size={13} aria-hidden="true" />
  </button>;
  return <>
    {field ? <label>{label}{control}</label> : control}
    {open && <DropdownLayer id={id} trigger={trigger} panel={panel} role="listbox" label={label} close={close}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" className="dropdown-row"
        aria-selected={index === selected} aria-disabled={option.disabled} data-active={index === active ? '' : undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <span className="dropdown-row-label" title={option.label}>{option.label}</span>
        {index === selected && <Check className="dropdown-row-check" size={14} aria-hidden="true" />}
      </div>)}
    </DropdownLayer>}
  </>;
}

import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Settings2, X } from 'lucide-react';
import { IconButton, Modal } from '../../components/ui';

export const defaultModelStyles = ['自然', '清新', '复古', '胶片', '日系', '法式', '时尚', '街头', '电影感', '情绪', '黑白', '极简', '古风', '运动', '生活感', '杂志感'];

export function ModelStyleTags({ value, options, onChange, disabled }: {
  value: string[]; options: string[]; onChange: (tags: string[], options: string[]) => void; disabled: boolean;
}) {
  const titleId = useId();
  const [managing, setManaging] = useState(false);
  const selected = [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
  const lastOption = options.at(-1);
  function renderOption(option: string) {
    const pressed = selected.includes(option);
    return <button type="button" className="model-style-tag" key={option} aria-pressed={pressed} disabled={disabled || (!pressed && selected.length >= 50)}
      onClick={() => { if (!disabled) onChange(pressed ? selected.filter((item) => item !== option) : [...selected, option], options); }}>
      <span>{option}</span>
    </button>;
  }
  return <div className="model-style-tags">
    <span id={titleId}>风格标签</span>
    <div className="model-style-options" role="group" aria-labelledby={titleId}>
      {options.slice(0, -1).map(renderOption)}
      <span className="model-style-tail">
        {lastOption !== undefined && renderOption(lastOption)}
        <IconButton label="管理风格标签" disabled={disabled} onClick={() => setManaging(true)}><Settings2 size={14} /></IconButton>
      </span>
    </div>
    {managing && createPortal(<TagManager options={options} selected={selected} disabled={disabled} onClose={() => setManaging(false)}
      onAdd={(tag) => {
        onChange(selected.includes(tag) ? selected : [...selected, tag], options.includes(tag) ? options : [...options, tag]);
      }} onRemove={(tag) => {
        onChange(selected.filter((item) => item !== tag), options.filter((item) => item !== tag));
      }} />, document.body)}
  </div>;
}

function TagManager({ options, selected, disabled, onAdd, onRemove, onClose }: {
  options: string[]; selected: string[]; disabled: boolean; onAdd: (tag: string) => void; onRemove: (tag: string) => void; onClose: () => void;
}) {
  const inputId = useId();
  const composing = useRef(false);
  const [pending, setPending] = useState('');
  const tag = pending.trim();
  const error = [...tag].length > 80 ? '风格标签最多 80 个字符' : tag.includes('\0') ? '风格标签不能包含空字符'
    : tag && !options.includes(tag) && options.length >= 100 ? '可选风格标签最多 100 个，请先删除不需要的标签'
    : tag && !selected.includes(tag) && selected.length >= 50 ? '已选风格标签最多 50 个' : '';
  function add() {
    if (disabled || !tag || error || composing.current) return;
    onAdd(tag);
    setPending('');
  }
  return <Modal title="管理风格标签" onClose={onClose}>
    <div className="model-style-manager">
      <div className="model-style-add">
        <input id={inputId} aria-label="自定义风格标签" placeholder="自定义标签" value={pending} disabled={disabled} maxLength={80} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => setPending(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            add();
          }} />
        <button type="button" className="button" disabled={disabled || !tag || !!error} onClick={add}><Plus size={13} />添加</button>
      </div>
      {error && <p id={`${inputId}-error`} className="form-error" role="alert">{error}</p>}
      {options.length ? <ul className="model-style-custom-list">{options.map((option) => <li key={option}><span>{option}</span><IconButton label={`删除标签“${option}”`} disabled={disabled} onClick={() => { if (!disabled) onRemove(option); }}><X size={14} /></IconButton></li>)}</ul> : <p className="model-style-empty">暂无风格标签</p>}
    </div>
  </Modal>;
}

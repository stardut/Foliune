import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { IconButton } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';
import type { LibrarySnapshot, Photo } from '../../lib/types';
import type { SocialSimulationInput } from '../../lib/social-types';
import { SocialPreview, platformOptions } from './SocialPreview';
import { SocialPhotoSequence } from './SocialPhotoSequence';
import './social.css';

export function SocialWorkspace({ snapshot, onRelink, initialPhotoIds, onExit }: {
  snapshot: LibrarySnapshot; initialPhotoIds: string[]; onExit: () => void;
  onRelink?: (photo: Photo) => Promise<void>;
}) {
  const photos = snapshot.photos;
  const [input, setInput] = useState<SocialSimulationInput>(() => ({ platform: 'moments', title: '', body: '', photoIds: [...initialPhotoIds] }));
  const [picking, setPicking] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const main = workspace?.closest('main');
    if (!workspace || !main) return;
    const measure = () => {
      const bottomInset = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      // The parent's layout effect restores main.scrollTop after children run.
      // Measure the content origin so entering from a scrolled album is stable.
      const contentTop = workspace.getBoundingClientRect().top + main.scrollTop;
      setHeight(Math.max(240, main.getBoundingClientRect().bottom - contentTop - bottomInset));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const platform = platformOptions.find((option) => option.id === input.platform)!;
  const overLimit = input.photoIds.length > platform.limit;
  const bodyLabel = input.platform === 'moments' ? '文案' : input.platform === 'instagram' ? '配文' : '正文';
  function patch<K extends keyof SocialSimulationInput>(key: K, value: SocialSimulationInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }
  return <section ref={workspaceRef} className="social-workspace" style={{ height }} aria-label="模拟排版">
    <header className="social-workspace-header"><IconButton label="返回相簿" onClick={onExit}><ArrowLeft size={17} /></IconButton></header>
    <div className="social-editor-layout">
      <div className="social-editor-tools">
        <div className="social-fields">
          <fieldset className="social-platform-picker">
            <legend>平台</legend>
            <div className="social-platform-options">{platformOptions.map((option) => <label key={option.id} className="social-platform-option">
              <input type="radio" name="social-platform" value={option.id} checked={input.platform === option.id} onChange={() => patch('platform', option.id)} />
              <span className="social-platform-radio" aria-hidden="true" />
              <span>{option.label}</span>
            </label>)}</div>
          </fieldset>
          {input.platform === 'xiaohongshu' && <label>标题<input maxLength={500} value={input.title} onChange={(event) => patch('title', event.target.value)} /></label>}
          <label>{bodyLabel}<textarea rows={5} maxLength={10000} value={input.body} onChange={(event) => patch('body', event.target.value)} /></label>
        </div>
        <div className="social-selection-heading"><h2>照片 <span>{input.photoIds.length}</span></h2><button type="button" className="text-button" onClick={() => setPicking(true)}><Plus size={15} />选片</button></div>
        {overLimit && <p className="social-limit" role="status">此平台模拟最多 {platform.limit} 张。预览前 {platform.limit} 张，已选 {input.photoIds.length} 张。</p>}
        {!input.photoIds.length ? <button type="button" className="social-add-photos" onClick={() => setPicking(true)}><Plus size={22} /><span>从图库添加照片</span></button> : <SocialPhotoSequence ids={input.photoIds} photos={photos} onChange={(ids) => patch('photoIds', ids)} />}
      </div>
      <SocialPreview key={input.platform} input={input} photos={photos} onRelink={onRelink} />
    </div>
    {picking && <PhotoPicker title="排版选片" snapshot={snapshot} selectedIds={input.photoIds} onConfirm={(ids) => { patch('photoIds', ids); setPicking(false); }} onClose={() => setPicking(false)} />}
  </section>;
}

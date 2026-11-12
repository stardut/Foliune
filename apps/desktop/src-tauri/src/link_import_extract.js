(() => {
  if (window.top !== window) return;
  const config = __FOLIUNE_CONFIG__;
  const started = Date.now();
  let previous = '', stable = 0, finished = false, gateSince = 0;
  const walk = (root, visit) => {
    const stack = [root], seen = new Set();
    let count = 0;
    while (stack.length && count++ < 250000) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node); visit(node);
      for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
    }
    return stack.length === 0;
  };
  const instagram = () => {
    const matches = [];
    const publicCarousels = new Set();
    let traversed = true;
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (!script.textContent || script.textContent.length > 12 * 1024 * 1024) continue;
      let root; try { root = JSON.parse(script.textContent); } catch { continue; }
      traversed = walk(root, node => {
        if (node.code === config.id) matches.push(node);
        const post = node.result?.data?.xig_polaris_media;
        if (post?.code === config.id && post.__typename === 'XIGPolarisCarouselMedia') {
          publicCarousels.add(post.if_not_gated_logged_out);
        }
      }) && traversed;
    }
    const counts = [...new Set(matches.map(node => node.carousel_media_count).filter(count => count != null))];
    const hasCarousel = matches.some(node => node.media_type === 8 || node.__typename === 'XIGPolarisCarouselMedia');
    const isVideo = node => node?.media_type === 2 || node?.is_video === true;
    const imageOf = node => {
      const candidates = node?.image_versions2?.candidates;
      if (node?.media_type !== 1 || isVideo(node) || !Array.isArray(candidates)) return null;
      const choices = candidates.filter(x => typeof x?.url === 'string');
      // Stable sorting preserves the platform's first choice when dimensions are absent.
      choices.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
      return choices[0]?.url || null;
    };
    for (const node of matches) {
      if (node.media_type === 8 && Array.isArray(node.carousel_media)) {
        const children = node.carousel_media;
        if (children.some(isVideo)) return { error: 'video' };
        if (!traversed || children.length === 0) continue;
        const counted = counts.length === 1 && counts[0] === children.length;
        // The public Polaris payload carries the ordered media records without a separate count.
        const publicList = counts.length === 0 && publicCarousels.has(node)
          && node.__typename === 'XIGPolarisCarouselMedia' && children.length > 1
          && children.every(child => child?.__typename === 'XIGPolarisImageMedia' && typeof child.id === 'string' && child.id.length > 0)
          && new Set(children.map(child => child.id)).size === children.length;
        if (counted || publicList) {
          const images = children.map(imageOf);
          if (images.every(Boolean)) return { images, expected: children.length };
        }
      }
      if (isVideo(node)) return { error: 'video' };
      if (!hasCarousel && node.media_type === 1 && counts.every(n => n === 1)) {
        const image = imageOf(node);
        if (traversed && image) return { images: [image], expected: 1 };
      }
    }
    return { images: [], expected: 0 };
  };
  const xhs = () => {
    const notes = [];
    let traversed = walk(window.__INITIAL_STATE__, node => {
      if ((node.noteId === config.id || node.id === config.id) && Array.isArray(node.imageList)) notes.push(node);
      const entry = node[config.id];
      if (entry?.note && Array.isArray(entry.note.imageList) && (entry.note.noteId === config.id || entry.note.id === config.id)) notes.push(entry.note);
    });
    const path = location.pathname.split('/').filter(Boolean);
    if (path[path.length - 1] !== config.id) return { images: [], expected: 0 };
    const counts = [...new Set(notes.map(note => note.imageList.length))];
    if (notes.some(note => note.type === 'video')) return { error: 'video' };
    const images = [...document.querySelectorAll('#noteContainer .swiper-slide:not(.swiper-slide-duplicate) .note-slider-img img')]
      .map(img => ({ src: img.currentSrc || img.src, index: Number(img.closest('.swiper-slide')?.getAttribute('data-swiper-slide-index')) }));
    const ordered = images.every((image, index) => image.src && image.index === index);
    if (traversed && counts.length === 1 && counts[0] > 0 && images.length === counts[0] && ordered) return { images: images.map(x => x.src), expected: counts[0] };
    return { images: [], expected: counts[0] || 0 };
  };
  const send = report => {
    if (finished) return;
    finished = true; clearInterval(timer);
    const bytes = new TextEncoder().encode(JSON.stringify({ ...report, id: config.id }));
    let binary = ''; bytes.forEach(byte => binary += String.fromCharCode(byte));
    location.href = `foliune-link://${config.nonce}/result/` + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  };
  const timer = setInterval(() => {
    if (finished) return;
    try {
      const media = config.platform === 'xhs' ? xhs() : instagram();
      const body = document.body?.innerText || '';
      const blocked = /\/(challenge|checkpoint)/i.test(location.pathname) || /安全验证|访问异常|验证你是真人|Confirm you.re human|unusual activity|security check/i.test(body);
      const login = /\/(login|signin|accounts\/signup)/i.test(location.pathname) || /登录后.{0,12}查看|登录以查看|Log in to see (?:photos|videos|posts)|Sign up or log in to see/i.test(body);
      const unavailable = /当前内容无法展示|笔记不存在|Sorry, this page isn't available|This page isn’t available|Something went wrong|页面不可用/.test(body);
      const gate = blocked ? 'blocked' : login ? 'login_required' : unavailable ? 'unavailable' : null;
      if (gate) { if (!gateSince) gateSince = Date.now(); } else gateSince = 0;
      const signature = JSON.stringify([media.images, media.expected, media.error, gate]);
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      if (media.error === 'video') return send({ status: 'video', images: [], expected: 0 });
      if (!gate && media.images?.length > 0 && stable >= 3) return send({ status: 'complete', ...media });
      if (gate && Date.now() - gateSince >= 12000 && Date.now() - started >= 15000) return send({ status: gate, images: [], expected: 0 });
      if (Date.now() - started >= 60000) send({ status: 'incomplete', images: [], expected: 0 });
    } catch {
      if (Date.now() - started >= 60000) send({ status: 'incomplete', images: [], expected: 0 });
    }
  }, 1000);
})();

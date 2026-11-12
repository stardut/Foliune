import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const script = readFileSync(new URL('./link_import_extract.js', import.meta.url), 'utf8');
function extract(platform, options) {
  let callback, href = '', time = 0;
  const location = { pathname: options.path, set href(value) { href = value; } };
  const window = { __INITIAL_STATE__: options.state }; window.top = window;
  const document = {
    body: { innerText: options.body || '' },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/json"]') return [{ textContent: JSON.stringify(options.json) }];
      if (selector === '#noteContainer .swiper-slide:not(.swiper-slide-duplicate)') return options.slides || [];
      return options.slides?.map(slide => slide.querySelector('.note-slider-img img')).filter(Boolean) || [];
    },
  };
  runInNewContext(script.replace('__FOLIUNE_CONFIG__', JSON.stringify({ platform, id: options.id, nonce: 'fixture' })), {
    window, document, location, TextEncoder, btoa: value => Buffer.from(value,'binary').toString('base64'),
    Date: { now: () => time }, setInterval: fn => { callback = fn; return 1; }, clearInterval() {},
  });
  for (let tick = 0; tick < 65 && !href; tick++) { time += 1000; callback(); }
  assert.ok(href, 'extractor reports a terminal result');
  return JSON.parse(Buffer.from(href.split('/result/')[1], 'base64url'));
}
const image = number => ({ media_type: 1, image_versions2: { candidates: [{ url: `https://s.cdninstagram.com/${number}.jpg?sig=unchanged` }] } });
const imageUrl = media => media.image_versions2.candidates[0].url;
const video = number => ({ ...image(`cover-${number}`), media_type: 2, is_video: true });
const code = 'DfSi56IFwZK';
const instagram = (json, body) => extract('instagram', { id: code, path: `/nasa/p/${code}/`, json, body });
const countedPost = (items, count) => ({ nodes: [{ code, media_type: 8, carousel_media: items }, { code, carousel_media_count: count }] });
test('Instagram 显式计数轮播完整后按原顺序提取静态照片', () => {
  assert.deepEqual(instagram(countedPost([image(1), image(2)], 2)), {
    id: code, status: 'complete', expected: 2, images: [imageUrl(image(1)), imageUrl(image(2))],
  });
  assert.deepEqual(instagram(countedPost([video(1), image(2), video(3), image(4)], 4)), {
    id: code, status: 'complete', expected: 2, images: [imageUrl(image(2)), imageUrl(image(4))],
  });
  assert.equal(instagram(countedPost([image(1)], 2)).status, 'incomplete');
  assert.equal(instagram({ code: 'OTHER', ...image(1) }).status, 'incomplete');
});

test('Instagram 只有已证实完整的全视频媒体才能报告无照片', () => {
  assert.deepEqual(instagram(countedPost([video(1), video(2)], 2)), {
    id: code, status: 'video', expected: 0, images: [],
  });
  assert.equal(instagram({ code, ...video(1) }).status, 'video');
  assert.equal(instagram(countedPost([video(1)], 2)).status, 'incomplete');
  assert.equal(instagram(countedPost([video(1), { media_type: 99 }], 2)).status, 'incomplete');
  assert.equal(instagram(countedPost([video(1), { media_type: 1 }], 2)).status, 'incomplete');
  assert.equal(instagram({ partial: countedPost([video(1)], 2), cover: { code, ...video(1) } }).status, 'incomplete');
});

const carouselType = 'XIGPolarisCarouselMedia';
const children = Array.from({ length: 17 }, (_, index) => ({
  ...image(index + 1), id: `photo-${index + 1}`, __typename: 'XIGPolarisImageMedia',
}));
const carousel = { code, __typename: carouselType, media_type: 8, carousel_media: children };
const publicPost = (media, outerCode = code) => ({
  __bbox: { result: { data: { xig_polaris_media: {
    code: outerCode, __typename: carouselType, if_not_gated_logged_out: media,
  } } } },
});
const polarisVideo = number => ({ ...video(number), id: `video-${number}`, __typename: 'XIGPolarisVideoMedia' });
const publicCarousel = items => publicPost({ ...carousel, carousel_media: items });
test('Instagram 公开 Polaris 轮播只提取有序照片，视频封面不进入候选', () => {
  const result = instagram(publicPost(carousel), 'Never miss a post\nSign up for Instagram to stay in the loop.');
  assert.equal(result.status, 'complete');
  assert.equal(result.expected, 17);
  assert.deepEqual(result.images, children.map(imageUrl));
  const mixed = [children[0], children[1], polarisVideo(3), polarisVideo(4), polarisVideo(5), children[5], polarisVideo(7), polarisVideo(8)];
  assert.deepEqual(instagram(publicCarousel(mixed)), {
    id: code, status: 'complete', expected: 3, images: [children[0], children[1], children[5]].map(imageUrl),
  });
  assert.equal(instagram(publicCarousel([polarisVideo(1), polarisVideo(2)])).status, 'video');
});

test('Instagram 公开 Polaris 不接收不完整或类型不明的轮播', () => {
  assert.equal(instagram(carousel).status, 'incomplete');
  assert.equal(instagram(publicPost(carousel, 'OTHER')).status, 'incomplete');
  assert.equal(instagram(publicPost({ ...carousel, carousel_media_count: 18 })).status, 'incomplete');
  assert.equal(instagram(publicCarousel([children[0]])).status, 'incomplete');
  assert.equal(instagram(publicCarousel([children[0], { ...polarisVideo(2), id: children[0].id }])).status, 'incomplete');
  assert.equal(instagram(publicCarousel([children[0], null])).status, 'incomplete');
  assert.equal(instagram(publicCarousel([children[0], video(2)])).status, 'incomplete');
  assert.equal(instagram(publicCarousel([children[0], { ...polarisVideo(2), media_type: 1 }])).status, 'incomplete');
  assert.equal(instagram(publicCarousel([polarisVideo(1), { ...children[1], image_versions2: null }])).status, 'incomplete');
  assert.equal(instagram({ post: publicPost(null), cover: { code, ...image(1) } }).status, 'incomplete');
  assert.equal(instagram(publicPost(carousel), 'Log in to see posts').status, 'login_required');
  assert.equal(instagram(publicCarousel([polarisVideo(1), polarisVideo(2)]), 'Log in to see posts').status, 'login_required');
});

const id = '6ac7142b000000001a032408';
const xhsImage = index => `https://s.xhscdn.com/${index}.jpg`;
const xhsSlide = (index, { playing = false, hasImage = true } = {}) => {
  const slide = {
    getAttribute: name => name === 'data-swiper-slide-index' ? String(index) : null,
    querySelector(selector) {
      if (selector === 'video') return playing ? {} : null;
      if (selector === '.note-slider-img img' && hasImage) return { src: xhsImage(index), closest: () => slide };
      return null;
    },
  };
  return slide;
};
const xhs = (note, slides, path = `/explore/${id}`) => extract('xhs', {
  id, path, slides, state: { note: { noteDetailMap: { [id]: { note: { noteId: id, ...note } } } } },
});
const xhsVideo = { type: 'video', video: { consumer: { originVideoKey: 'sample.mp4' } } };
test('小红书保留正文 LIVE 静态图和原顺序', () => {
  const imageList = Array.from({ length: 5 }, (_, index) => ({ livePhoto: index > 1 }));
  const slides = imageList.map(({ livePhoto }, index) => xhsSlide(index, { playing: livePhoto }));
  const note = { type: 'normal', imageList };
  assert.deepEqual(xhs(note, slides), { id, status: 'complete', expected: 5, images: imageList.map((_, index) => xhsImage(index)) });
  assert.equal(xhs(note, slides.slice(0, 4)).status, 'incomplete');
  assert.equal(xhs(note, slides, '/explore/another').status, 'incomplete');
});

test('小红书读取正文图集并跳过明确的视频轮播项', () => {
  const note = { ...xhsVideo, imageList: [{}, {}, {}, { livePhoto: true }] };
  const slides = [xhsSlide(0), xhsSlide(1, { playing: true }), xhsSlide(2, { playing: true, hasImage: false }), xhsSlide(3, { playing: true })];
  assert.deepEqual(xhs(note, slides), { id, status: 'complete', expected: 2, images: [xhsImage(0), xhsImage(3)] });
  assert.deepEqual(xhs({ ...xhsVideo, imageList: [{}, {}] }, [xhsSlide(0), xhsSlide(1)]), {
    id, status: 'complete', expected: 2, images: [xhsImage(0), xhsImage(1)],
  });
  assert.equal(xhs(note, slides.slice(1)).status, 'incomplete');
  assert.equal(xhs(note, [xhsSlide(0, { hasImage: false }), ...slides.slice(1)]).status, 'incomplete');
});

test('小红书视频封面不进入候选，正文证据不完整时不判断为纯视频', () => {
  assert.deepEqual(xhs({ ...xhsVideo, imageList: [{}] }, [xhsSlide(0)]), {
    id, status: 'video', expected: 0, images: [],
  });
  assert.equal(xhs({ ...xhsVideo, imageList: [{}] }, []).status, 'video');
  assert.equal(xhs({ type: 'video', imageList: [{}] }, [xhsSlide(0)]).status, 'incomplete');
  assert.equal(xhs({ ...xhsVideo, imageList: [{}, {}] }, [xhsSlide(0, { playing: true })]).status, 'incomplete');
});

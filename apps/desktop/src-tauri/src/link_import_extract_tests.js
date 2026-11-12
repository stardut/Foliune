import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const script = readFileSync(new URL('./link_import_extract.js', import.meta.url), 'utf8');
function extract(platform, options) {
  let callback, href = '', time = 0;
  const location = { pathname: options.path, set href(value) { href = value; } };
  const window = { __INITIAL_STATE__: options.state }; window.top = window;
  const document = { body: { innerText: options.body || '' }, querySelectorAll(selector) { return selector === 'script[type="application/json"]' ? [{ textContent: JSON.stringify(options.json) }] : options.images || []; } };
  runInNewContext(script.replace('__FOLIUNE_CONFIG__', JSON.stringify({ platform, id: options.id, nonce: 'fixture' })), {
    window, document, location, TextEncoder, btoa: value => Buffer.from(value,'binary').toString('base64'),
    Date: { now: () => time }, setInterval: fn => { callback = fn; return 1; }, clearInterval() {},
  });
  for (let tick = 0; tick < 65 && !href; tick++) { time += 1000; callback(); }
  assert.ok(href, 'extractor reports a terminal result');
  return JSON.parse(Buffer.from(href.split('/result/')[1], 'base64url'));
}
const image = number => ({ media_type: 1, image_versions2: { candidates: [{ url: `https://s.cdninstagram.com/${number}.jpg?sig=unchanged` }] } });
const code = 'DfSi56IFwZK';
const instagram = (json, body) => extract('instagram', { id: code, path: `/nasa/p/${code}/`, json, body });
let result = instagram({ nodes: [{ code, media_type: 8, carousel_media: [image(1), image(2)] }, { code, carousel_media_count: 2 }] });
assert.equal(result.status, 'complete'); assert.equal(result.images.length, 2);
assert.equal(result.images[0], image(1).image_versions2.candidates[0].url);
assert.equal(instagram({ nodes: [{ code, media_type: 8, carousel_media: [image(1)] }, { code, carousel_media_count: 2 }] }).status,'incomplete');
assert.equal(instagram({ nodes: [{ code, media_type: 8, carousel_media: [image(1),{ media_type: 2 }] }, { code, carousel_media_count: 2 }] }).status,'video');
assert.equal(instagram({ code:'OTHER', media_type:1, ...image(1) }).status,'incomplete');

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
result = instagram(publicPost(carousel), 'Never miss a post\nSign up for Instagram to stay in the loop.');
assert.equal(result.status, 'complete');
assert.equal(result.expected, 17);
assert.deepEqual(result.images, children.map(child => child.image_versions2.candidates[0].url));
assert.equal(instagram(carousel).status, 'incomplete');
assert.equal(instagram(publicPost(carousel, 'OTHER')).status, 'incomplete');
assert.equal(instagram(publicPost({ ...carousel, carousel_media_count: 18 })).status, 'incomplete');
assert.equal(instagram(publicPost({ ...carousel, carousel_media: [children[0]] })).status, 'incomplete');
assert.equal(instagram(publicPost({ ...carousel, carousel_media: [children[0], { ...children[1], id: children[0].id }] })).status, 'incomplete');
assert.equal(instagram(publicPost({ ...carousel, carousel_media: [children[0], null] })).status, 'incomplete');
assert.equal(instagram(publicPost({ ...carousel, carousel_media: [children[0], { media_type: 2 }] })).status, 'video');
assert.equal(instagram({ post: publicPost(null), cover: { code, ...image(1) } }).status, 'incomplete');
assert.equal(instagram(publicPost(carousel), 'Log in to see posts').status, 'login_required');

const id = '6ac7142b000000001a032408';
const images = Array.from({length:5}, (_,index) => ({ src:`https://s.xhscdn.com/${index}.jpg`, closest:()=>({ getAttribute:()=>String(index) }) }));
const state = { note: { noteDetailMap: { [id]: { note: { noteId:id, type:'normal', imageList: images.map((_,index)=>({livePhoto:index>1})) } } } } };
result = extract('xhs',{id,path:`/explore/${id}`,state,images});
assert.equal(result.status,'complete'); assert.equal(result.images.length,5);
assert.equal(extract('xhs',{id,path:`/explore/${id}`,state,images:images.slice(0,4)}).status,'incomplete');
assert.equal(extract('xhs',{id,path:'/explore/another',state,images}).status,'incomplete');
console.log('链接提取器 fixture 通过，覆盖小红书 LIVE 静态图和 Instagram 显式计数及公开轮播列表。');

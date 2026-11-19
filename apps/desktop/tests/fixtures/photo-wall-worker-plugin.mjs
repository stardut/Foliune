// esbuild does not implement Vite's Worker imports. Keep the existing Worker
// harness at this build boundary; geometry is still imported and tested directly.
export const photoWallWorkerPlugin = {
  name: 'photo-wall-worker',
  setup(build) {
    build.onResolve({ filter: /\/photo-wall\.worker\?worker&inline$/ }, ({ path }) => ({ path, namespace: 'photo-wall-worker' }));
    build.onLoad({ filter: /.*/, namespace: 'photo-wall-worker' }, () => ({
      contents: 'export default function PhotoWallWorker() { return new globalThis.Worker(); }',
    }));
  },
};

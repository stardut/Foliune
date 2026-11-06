import { photoWallLayoutBatches, type PhotoWallResponse, type WallLayoutInput } from './photo-wall-layout';

self.onmessage = (event: MessageEvent<WallLayoutInput>) => {
  const send = (response: PhotoWallResponse) => self.postMessage(response);
  try {
    for (const batch of photoWallLayoutBatches(event.data)) send(batch);
  } catch (cause) {
    send({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};

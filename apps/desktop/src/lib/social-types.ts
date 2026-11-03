export type SocialPlatform = 'moments' | 'xiaohongshu' | 'instagram';

export interface SocialSimulationInput {
  platform: SocialPlatform;
  title: string;
  body: string;
  photoIds: string[];
}

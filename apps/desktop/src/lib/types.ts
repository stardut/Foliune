export type LibraryKind = 'collection' | 'work';
export type MembershipStatus = 'active' | 'discarded';

export interface PhotoRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface Photo {
  id: string;
  library: LibraryKind;
  title: string;
  originalName: string;
  originalPath: string;
  thumbnailPath: string;
  originalUrl: string;
  thumbnailUrl: string;
  originalAvailable: boolean;
  thumbnailAvailable: boolean;
  availability?: 'available' | 'offline' | 'missing';
  width: number;
  height: number;
  tags: string[];
  regions: PhotoRegion[];
  annotation: string;
  source: string;
  capturedAt: string | null;
  location: string;
  project: string;
  importedAt: string;
}

export interface PhotoMetadata {
  camera: string | null;
  lens: string | null;
  focalLengthMm: number | null;
  focalLength35mm: number | null;
  aperture: number | null;
  exposureSeconds: number | null;
  iso: number | null;
  exposureCompensationEv: number | null;
  exposureMode: 'auto' | 'manual' | 'autoBracket' | null;
  meteringMode: 'average' | 'centerWeightedAverage' | 'spot' | 'multiSpot' | 'pattern' | 'partial' | null;
  whiteBalance: 'auto' | 'manual' | null;
  flashFired: boolean | null;
  exifReadFailed: boolean;
  fileSizeBytes: number;
  fileFormat: 'JPEG' | 'PNG' | 'WebP';
}

export interface AlbumCover {
  photoId: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface Group {
  id: string;
  library: LibraryKind;
  name: string;
  description: string;
  capacity: number | null;
  createdAt: string;
  boundFolder?: string;
  cover?: AlbumCover | null;
}

export interface Membership {
  groupId: string;
  photoId: string;
  status: MembershipStatus;
  position: number;
}

export interface LibrarySnapshot {
  photos: Photo[];
  hiddenPhotoIds?: string[];
  groups: Group[];
  memberships: Membership[];
}

export interface PhotoPatch {
  title?: string;
  tags?: string[];
  regions?: PhotoRegion[];
  annotation?: string;
  source?: string;
  capturedAt?: string | null;
  location?: string;
  project?: string;
}

export interface GroupInput {
  library: LibraryKind;
  name: string;
  description?: string;
  capacity?: number | null;
}

export interface GroupPatch {
  name?: string;
  description?: string;
  capacity?: number | null;
  cover?: AlbumCover;
}

export interface ImportResult {
  snapshot: LibrarySnapshot;
  importedIds: string[];
  failures: { path: string; message: string }[];
}

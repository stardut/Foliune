export interface ModelInput {
  name: string;
  contact: string;
  city: string;
  tags: string[];
  tagOptions: string[] | null;
  notes: string;
  gender: string;
  birthday: string;
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  photoIds: string[];
  coverPhotoId: string | null;
}

export interface ModelProfile extends ModelInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type PostStatus = 'pending' | 'published' | 'failed';

export interface ScheduledPost {
  id: string;
  image_url: string;
  caption: string;
  scheduled_time: string; // ISO timestamp
  status: PostStatus;
  created_at?: string;
  error_message?: string | null;
  ig_media_id?: string | null;
  storage_path?: string | null;
}

export interface SchedulePayload {
  caption: string;
  scheduled_time: string;
}

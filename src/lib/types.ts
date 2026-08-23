export type Profile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: "admin" | "member";
  status: "pending" | "approved" | "removed";
  tags: string[];
  created_at: string;
};

export type Board = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
};

export type Task = {
  id: string;
  board_id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "review" | "done";
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  assignee?: Profile | null;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: Profile | null;
};

export type Channel = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
};

export type Conversation = {
  id: string;
  user1: string;
  user2: string;
  created_at: string;
  other?: Profile | null;
};

export type Message = {
  id: string;
  channel_id: string | null;
  conversation_id: string | null;
  sender_id: string;
  content: string | null;
  kind: "text" | "file" | "audio";
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  created_at: string;
  sender?: Profile | null;
};

export type Meeting = {
  id: string;
  title: string;
  created_by: string;
  status: "live" | "ended";
  started_at: string;
  ended_at: string | null;
  creator?: Profile | null;
};

export type MeetingParticipant = {
  id: string;
  meeting_id: string;
  user_id: string;
  invited: boolean;
  joined_at: string | null;
  user?: Profile | null;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

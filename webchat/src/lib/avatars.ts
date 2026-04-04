import { AUTH_TOKEN, GATEWAY_URL } from "./config";

export interface AvatarProfile {
  id: string;
  user_id: string | null;
  agent_role: string;
  model_url: string;
  anim_urls: Record<string, string>;
  style: string;
  source: string;
}

export async function fetchAvatars(): Promise<AvatarProfile[]> {
  const res = await fetch(`${GATEWAY_URL}/api/avatars`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });
  if (!res.ok) return [];
  return (await res.json()) as AvatarProfile[];
}

export async function fetchAvatar(role: string): Promise<AvatarProfile | null> {
  const res = await fetch(`${GATEWAY_URL}/api/avatars/${encodeURIComponent(role)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as AvatarProfile;
}

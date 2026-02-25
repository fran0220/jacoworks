const RECENT_FOLDERS_KEY = "jacoworks_recent_folders";
const MAX_RECENT = 6;

export function getRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentFolder(path: string) {
  const recent = getRecentFolders().filter((value) => value !== path);
  recent.unshift(path);
  localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

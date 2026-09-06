const key = "usc-planner-v1";
export async function readPreferences(): Promise<unknown> {
  if (typeof chrome !== "undefined" && chrome.storage?.local)
    return (await chrome.storage.local.get(key))[key];
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}
export async function savePreferences(value: unknown) {
  if (typeof chrome !== "undefined" && chrome.storage?.local)
    await chrome.storage.local.set({ [key]: value });
  else localStorage.setItem(key, JSON.stringify(value));
}

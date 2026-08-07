import { Stronghold } from '@tauri-apps/plugin-stronghold';

const VAULT_FILE = 'vault.stronghold';
const VAULT_PASS = 'vault_agent_stronghold_secure_password';
const CLIENT_ID = 'vault_agent_secrets_client';

// Check if we are running in Tauri
const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// In-memory/localStorage fallback for non-tauri/web environment
const webFallbackStore: Record<string, string> = {};

export async function saveSecret(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    webFallbackStore[key] = value;
    localStorage.setItem(`sec_${key}`, value);
    return;
  }

  try {
    const stronghold = await Stronghold.load(VAULT_FILE, VAULT_PASS);
    const client = await stronghold.loadClient(CLIENT_ID);
    const store = client.getStore();
    const bytes = Array.from(new TextEncoder().encode(value));
    await store.insert(key, bytes);
    await stronghold.save();
  } catch (err) {
    console.error(`Failed to save secret to Stronghold: ${err}`);
    // Fallback
    localStorage.setItem(`sec_${key}`, value);
  }
}

export async function getSecret(key: string): Promise<string> {
  if (!isTauri()) {
    return webFallbackStore[key] || localStorage.getItem(`sec_${key}`) || "";
  }

  try {
    const stronghold = await Stronghold.load(VAULT_FILE, VAULT_PASS);
    const client = await stronghold.loadClient(CLIENT_ID);
    const store = client.getStore();
    const bytes = await store.get(key);
    if (!bytes || bytes.length === 0) return "";
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch (err) {
    console.error(`Failed to load secret from Stronghold: ${err}`);
    return localStorage.getItem(`sec_${key}`) || "";
  }
}

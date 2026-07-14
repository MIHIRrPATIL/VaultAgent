export const VAULT_AGENT_PLACEHOLDERS: string[] = [
  "Discombobulate the unheard...",
  "Untangle the internet into something worth keeping...",
  "Feed me chaos, I'll hand back clarity...",
  "Whisper a topic, I'll return with receipts...",
  "Summon a rabbit hole, tame it into notes...",
  "Turn scattered thoughts into constellations...",
  "Give me a spark, I'll build the web around it...",
  "Point me at the internet and stand back...",
  "Unleash the little research gremlin...",
  "Send me down a wormhole, I'll bring back links...",
  "Excavate the obvious...",
  "Domesticate the noise...",
  "Interrogate the internet, return with notes...",
  "Distill the unread...",
];

/**
 * Returns a random placeholder from the list.
 * Call once per mount / per input-clear event.
 */
export function getRandomPlaceholder(): string {
  const i = Math.floor(Math.random() * VAULT_AGENT_PLACEHOLDERS.length);
  return VAULT_AGENT_PLACEHOLDERS[i];
}
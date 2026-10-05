export function adsEnabled() {
  return import.meta.env.DEV || Boolean(import.meta.env.PUBLIC_ADSENSE_CLIENT);
}

export const adSlots = {
  top: import.meta.env.PUBLIC_ADSENSE_SLOT_TOP ?? '',
  article: import.meta.env.PUBLIC_ADSENSE_SLOT_ARTICLE ?? '',
  feed: import.meta.env.PUBLIC_ADSENSE_SLOT_FEED ?? '',
  sidebar: import.meta.env.PUBLIC_ADSENSE_SLOT_SIDEBAR ?? '',
} as const;

export type AdSlotName = keyof typeof adSlots;

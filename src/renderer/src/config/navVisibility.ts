import type { SidebarIcon } from '@renderer/types'

/**
 * Navigation item visibility for the MPF operator build.
 *
 * Controls which nav items are hidden from the UI. Backed by localStorage
 * (not Redux — the settings store is under a v2 feature freeze) and exposed
 * as a tiny reactive store so the Settings panel and the nav components stay
 * in sync without a restart.
 *
 * Keys are either `SidebarIcon` values (main-menu icons) or fixed control
 * keys that are not part of the sidebar-icons system ('theme').
 */
export type ControllableNavItem = SidebarIcon | 'theme'

/** Items the visibility panel can toggle ('assistants' is always shown). */
export const CONTROLLABLE_NAV_ITEMS: ControllableNavItem[] = [
  'agents',
  'store',
  'paintings',
  'translate',
  'minapp',
  'knowledge',
  'files',
  'code_tools',
  'notes',
  'openclaw',
  'theme'
]

const STORAGE_KEY = 'mpf-hidden-nav-items'
const DEFAULT_HIDDEN: ControllableNavItem[] = ['agents', 'theme']

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return new Set(JSON.parse(raw) as string[])
    }
  } catch {
    // fall through to the default on parse/storage errors
  }
  return new Set(DEFAULT_HIDDEN)
}

let hidden: Set<string> = load()
const listeners = new Set<() => void>()

export function getHiddenNavItems(): Set<string> {
  return hidden
}

export function isNavItemHidden(key: string): boolean {
  return hidden.has(key)
}

export function setNavItemHidden(key: string, value: boolean): void {
  const next = new Set(hidden)
  if (value) {
    next.add(key)
  } else {
    next.delete(key)
  }
  hidden = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // ignore persistence failures; in-memory state still updates
  }
  listeners.forEach((listener) => listener())
}

export function subscribeNavVisibility(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

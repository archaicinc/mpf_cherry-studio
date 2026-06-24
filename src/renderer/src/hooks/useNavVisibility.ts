import { getHiddenNavItems, setNavItemHidden, subscribeNavVisibility } from '@renderer/config/navVisibility'
import { useSyncExternalStore } from 'react'

/**
 * Reactive access to the nav-item visibility store. Components re-render when
 * an item is toggled, so the Settings panel and the navigation stay in sync.
 */
export function useNavVisibility() {
  const hidden = useSyncExternalStore(subscribeNavVisibility, getHiddenNavItems)
  return {
    hidden,
    isHidden: (key: string) => hidden.has(key),
    setHidden: setNavItemHidden
  }
}

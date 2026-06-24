import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONTROLLABLE_NAV_ITEMS,
  getHiddenNavItems,
  isNavItemHidden,
  setNavItemHidden,
  subscribeNavVisibility
} from '../navVisibility'

describe('navVisibility', () => {
  beforeEach(() => {
    // reset to the product defaults before each test (module state is a singleton)
    CONTROLLABLE_NAV_ITEMS.forEach((item) => setNavItemHidden(item, item === 'agents' || item === 'theme'))
  })

  it('hides agents and theme by default', () => {
    expect(isNavItemHidden('agents')).toBe(true)
    expect(isNavItemHidden('theme')).toBe(true)
  })

  it('does not hide other nav items by default', () => {
    expect(isNavItemHidden('files')).toBe(false)
    expect(isNavItemHidden('knowledge')).toBe(false)
  })

  it('toggles an item and reflects it in the hidden set', () => {
    setNavItemHidden('files', true)
    expect(isNavItemHidden('files')).toBe(true)
    expect(getHiddenNavItems().has('files')).toBe(true)

    setNavItemHidden('agents', false)
    expect(isNavItemHidden('agents')).toBe(false)
  })

  it('notifies subscribers on change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNavVisibility(listener)
    setNavItemHidden('files', true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setNavItemHidden('files', false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('exposes theme as a controllable item alongside sidebar icons', () => {
    expect(CONTROLLABLE_NAV_ITEMS).toContain('theme')
    expect(CONTROLLABLE_NAV_ITEMS).toContain('agents')
    expect(CONTROLLABLE_NAV_ITEMS).not.toContain('assistants')
  })
})

import { loggerService } from '@logger'
import { getHiddenNavItems, isTabHidden } from '@renderer/config/navVisibility'
import store from '@renderer/store'
import { removeTab, setActiveTab } from '@renderer/store/tabs'
import type { MinAppType } from '@renderer/types'
import { clearWebviewState } from '@renderer/utils/webviewStateManager'
import type { LRUCache } from 'lru-cache'

import NavigationService from './NavigationService'

const logger = loggerService.withContext('TabsService')

class TabsService {
  private minAppsCache: LRUCache<string, MinAppType> | null = null

  /**
   * Sets the reference to the mini-apps LRU cache used for managing mini-app lifecycle and cleanup.
   * This method is required to integrate TabsService with the mini-apps cache system, allowing TabsService
   * to perform cache cleanup when tabs associated with mini-apps are closed. The cache instance is typically
   * provided by the mini-app popup system and enables TabsService to maintain cache consistency and prevent
   * stale data.
   * @param cache The LRUCache instance containing mini-app data, provided by useMinappPopup.
   */
  public setMinAppsCache(cache: LRUCache<string, MinAppType>) {
    this.minAppsCache = cache
    logger.debug('Mini-apps cache reference set in TabsService')
  }
  /**
   * 关闭指定的标签页
   * @param tabId 要关闭的标签页ID
   * @returns 是否成功关闭
   */
  public closeTab(tabId: string): boolean {
    const state = store.getState()
    const tabs = state.tabs.tabs
    const activeTabId = state.tabs.activeTabId

    const tabToClose = tabs.find((tab) => tab.id === tabId)
    if (!tabToClose) {
      logger.warn(`Tab with id ${tabId} not found`)
      return false
    }

    // 如果只有一个标签页，不允许关闭
    if (tabs.length === 1) {
      logger.warn('Cannot close the last tab')
      return false
    }

    // 如果关闭的是当前激活的标签页，需要切换到其他标签页
    if (tabId === activeTabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
      // Prefer the last *visible* tab; never land on a hidden one (e.g. agents
      // when it's hidden via Item Visibility). 'home' is always present and
      // cannot be hidden, so it's the natural fallback.
      const hidden = getHiddenNavItems()
      const target =
        [...remainingTabs].reverse().find((tab) => !isTabHidden(tab.id, hidden)) ??
        remainingTabs.find((tab) => tab.id === 'home') ??
        remainingTabs[remainingTabs.length - 1]

      store.dispatch(setActiveTab(target.id))

      // 使用 NavigationService 导航到新的标签页
      if (NavigationService.navigate) {
        NavigationService.navigate(target.path)
      } else {
        logger.warn('Navigation service not ready, will navigate on next render')
        setTimeout(() => {
          if (NavigationService.navigate) {
            NavigationService.navigate(target.path)
          }
        }, 100)
      }
    }

    // Clean up mini-app cache if this is a mini-app tab
    this.cleanupMinAppCache(tabId)

    // 使用 Redux action 移除标签页
    store.dispatch(removeTab(tabId))

    logger.info(`Tab ${tabId} closed successfully`)
    return true
  }

  /**
   * Clean up mini-app cache and WebView state when tab is closed
   * @param tabId The tab ID to clean up
   */
  private cleanupMinAppCache(tabId: string) {
    // Check if this is a mini-app tab (format: /apps/{appId})
    const tabs = store.getState().tabs.tabs
    const tab = tabs.find((t) => t.id === tabId)

    if (tab && tab.path.startsWith('/apps/')) {
      const appId = tab.path.replace('/apps/', '')

      if (this.minAppsCache && this.minAppsCache.has(appId)) {
        logger.debug(`Cleaning up mini-app cache for app: ${appId}`)

        // Remove from LRU cache - this will trigger disposeAfter callback
        this.minAppsCache.delete(appId)

        // Clear WebView state
        clearWebviewState(appId)

        logger.info(`Mini-app ${appId} removed from cache due to tab closure`)
      }
    }
  }

  /**
   * 获取所有标签页
   */
  public getTabs() {
    return store.getState().tabs.tabs
  }

  /**
   * 获取当前激活的标签页ID
   */
  public getActiveTabId() {
    return store.getState().tabs.activeTabId
  }

  /**
   * 设置激活的标签页
   * @param tabId 标签页ID
   */
  public setActiveTab(tabId: string): boolean {
    const tabs = store.getState().tabs.tabs
    const tab = tabs.find((t) => t.id === tabId)

    if (!tab) {
      logger.warn(`Tab with id ${tabId} not found`)
      return false
    }

    store.dispatch(setActiveTab(tabId))

    // 导航到对应页面
    if (NavigationService.navigate) {
      NavigationService.navigate(tab.path)
    }

    return true
  }
}

export default new TabsService()

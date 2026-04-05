'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  getSubscriptions,
  isSubscribed as _isSubscribed,
  toggleSubscription as _toggle,
  type SubscriptionEntry,
} from './subscriptions'

interface SubscriptionsContextType {
  subscriptions: SubscriptionEntry[]
  isSubscribed: (id: string) => boolean
  toggle: (entry: SubscriptionEntry) => boolean
}

const SubscriptionsContext = createContext<SubscriptionsContextType | null>(null)

export function SubscriptionsProvider({ children }: { children: ReactNode }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionEntry[]>([])

  useEffect(() => {
    setSubscriptions(getSubscriptions())
  }, [])

  const isSubscribed = useCallback((id: string) => {
    return subscriptions.some((s) => s.id === id)
  }, [subscriptions])

  const toggle = useCallback((entry: SubscriptionEntry): boolean => {
    const isNow = _toggle(entry)
    setSubscriptions(getSubscriptions())
    return isNow
  }, [])

  return (
    <SubscriptionsContext.Provider value={{ subscriptions, isSubscribed, toggle }}>
      {children}
    </SubscriptionsContext.Provider>
  )
}

export function useSubscriptions() {
  const ctx = useContext(SubscriptionsContext)
  if (!ctx) throw new Error('useSubscriptions must be used within SubscriptionsProvider')
  return ctx
}

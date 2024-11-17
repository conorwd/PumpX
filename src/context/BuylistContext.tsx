'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Maintains a persistent list of Twitter usernames whose token calls will be automatically purchased when auto-buy is enabled
interface BuylistContextType {
  buylistedUsers: string[];
  addToBuylist: (username: string) => void;
  removeFromBuylist: (username: string) => void;
  isBuylisted: (username: string) => boolean;
}

const BuylistContext = createContext<BuylistContextType | undefined>(undefined);

export function BuylistProvider({ children }: { children: ReactNode }) {
  const [buylistedUsers, setBuylistedUsers] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load buylisted users from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const savedBuylist = localStorage.getItem('pumpfun_buylistedUsers');
      if (savedBuylist) {
        const parsed = JSON.parse(savedBuylist);
        if (Array.isArray(parsed)) {
          // Remove any duplicates and invalid entries
          const cleanedList = [...new Set(parsed)].filter(user => 
            typeof user === 'string' && user.trim().length > 0
          ).map(user => user.trim().toLowerCase());
          setBuylistedUsers(cleanedList);
        }
      }
    } catch (error) {
      console.error('Error loading buylist from localStorage:', error);
      try {
        localStorage.removeItem('pumpfun_buylistedUsers');
      } catch (e) {
        console.error('Failed to clear corrupted buylist:', e);
      }
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Save to localStorage whenever the buylist changes
  useEffect(() => {
    if (!isInitialized || typeof window === 'undefined') return;

    try {
      const uniqueList = [...new Set(buylistedUsers)].map(user => user.trim().toLowerCase());
      localStorage.setItem('pumpfun_buylistedUsers', JSON.stringify(uniqueList));
    } catch (error) {
      console.error('Error saving buylist to localStorage:', error);
    }
  }, [buylistedUsers, isInitialized]);

  const addToBuylist = (username: string) => {
    if (!username || typeof username !== 'string') return;
    
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) return;

    setBuylistedUsers(prev => {
      const newList = [...new Set([...prev, cleanUsername])];
      try {
        localStorage.setItem('pumpfun_buylistedUsers', JSON.stringify(newList));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
      return newList;
    });
  };

  const removeFromBuylist = (username: string) => {
    if (!username) return;
    const cleanUsername = username.trim().toLowerCase();
    setBuylistedUsers(prev => {
      const newList = prev.filter(u => u !== cleanUsername);
      try {
        localStorage.setItem('pumpfun_buylistedUsers', JSON.stringify(newList));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
      return newList;
    });
  };

  const isBuylisted = (username: string) => {
    if (!username) return false;
    const cleanUsername = username.trim().toLowerCase();
    return buylistedUsers.includes(cleanUsername);
  };

  return (
    <BuylistContext.Provider value={{
      buylistedUsers,
      addToBuylist,
      removeFromBuylist,
      isBuylisted,
    }}>
      {children}
    </BuylistContext.Provider>
  );
}

export function useBuylist() {
  const context = useContext(BuylistContext);
  if (context === undefined) {
    throw new Error('useBuylist must be used within a BuylistProvider');
  }
  return context;
}

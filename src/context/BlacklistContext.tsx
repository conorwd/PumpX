'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Maintains a persistent list of Twitter usernames to filter out from the feed, helping users avoid known scammers or unreliable token calls.

interface BlacklistContextType {
  blacklistedUsers: string[];
  addToBlacklist: (username: string) => void;
  removeFromBlacklist: (username: string) => void;
  isBlacklisted: (username: string) => boolean;
}

const BlacklistContext = createContext<BlacklistContextType | undefined>(undefined);

export function BlacklistProvider({ children }: { children: ReactNode }) {
  const [blacklistedUsers, setBlacklistedUsers] = useState<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load blacklisted users from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const savedBlacklist = localStorage.getItem('pumpfun_blacklistedUsers');
      if (savedBlacklist) {
        const parsed = JSON.parse(savedBlacklist);
        if (Array.isArray(parsed)) {
          // Remove any duplicates and invalid entries
          const cleanedList = [...new Set(parsed)].filter(user => 
            typeof user === 'string' && user.trim().length > 0
          ).map(user => user.trim().toLowerCase());
          setBlacklistedUsers(cleanedList);
        }
      }
    } catch (error) {
      console.error('Error loading blacklist from localStorage:', error);
      // If there's an error, try to recover by clearing localStorage
      try {
        localStorage.removeItem('pumpfun_blacklistedUsers');
      } catch (e) {
        console.error('Failed to clear corrupted blacklist:', e);
      }
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Save to localStorage whenever the blacklist changes
  useEffect(() => {
    if (!isInitialized || typeof window === 'undefined') return;

    try {
      // Remove any duplicates before saving
      const uniqueList = [...new Set(blacklistedUsers)].map(user => user.trim().toLowerCase());
      localStorage.setItem('pumpfun_blacklistedUsers', JSON.stringify(uniqueList));
    } catch (error) {
      console.error('Error saving blacklist to localStorage:', error);
    }
  }, [blacklistedUsers, isInitialized]);

  const addToBlacklist = (username: string) => {
    if (!username || typeof username !== 'string') return;
    
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) return;

    setBlacklistedUsers(prev => {
      const newList = [...new Set([...prev, cleanUsername])];
      try {
        localStorage.setItem('pumpfun_blacklistedUsers', JSON.stringify(newList));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
      return newList;
    });
  };

  const removeFromBlacklist = (username: string) => {
    if (!username) return;
    const cleanUsername = username.trim().toLowerCase();
    setBlacklistedUsers(prev => {
      const newList = prev.filter(u => u !== cleanUsername);
      try {
        localStorage.setItem('pumpfun_blacklistedUsers', JSON.stringify(newList));
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
      return newList;
    });
  };

  const isBlacklisted = (username: string) => {
    if (!username) return false;
    const cleanUsername = username.trim().toLowerCase();
    return blacklistedUsers.includes(cleanUsername);
  };

  return (
    <BlacklistContext.Provider value={{
      blacklistedUsers,
      addToBlacklist,
      removeFromBlacklist,
      isBlacklisted,
    }}>
      {children}
    </BlacklistContext.Provider>
  );
}

export function useBlacklist() {
  const context = useContext(BlacklistContext);
  if (context === undefined) {
    throw new Error('useBlacklist must be used within a BlacklistProvider');
  }
  return context;
}

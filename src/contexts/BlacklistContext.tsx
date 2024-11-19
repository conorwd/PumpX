'use client';

import React, { createContext, useContext, useState } from 'react';

interface BlacklistContextType {
  blacklistedUsers: string[];
  addToBlacklist: (user: string) => void;
  removeFromBlacklist: (user: string) => void;
  isBlacklisted: (user: string) => boolean;
}

const BlacklistContext = createContext<BlacklistContextType>({
  blacklistedUsers: [],
  addToBlacklist: () => {},
  removeFromBlacklist: () => {},
  isBlacklisted: () => false,
});

export const useBlacklistContext = () => useContext(BlacklistContext);

export const BlacklistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [blacklistedUsers, setBlacklistedUsers] = useState<string[]>([]);

  const addToBlacklist = (user: string) => {
    setBlacklistedUsers((prev) => [...new Set([...prev, user])]);
  };

  const removeFromBlacklist = (user: string) => {
    setBlacklistedUsers((prev) => prev.filter((u) => u !== user));
  };

  const isBlacklisted = (user: string) => {
    return blacklistedUsers.includes(user);
  };

  return (
    <BlacklistContext.Provider
      value={{
        blacklistedUsers,
        addToBlacklist,
        removeFromBlacklist,
        isBlacklisted,
      }}
    >
      {children}
    </BlacklistContext.Provider>
  );
};

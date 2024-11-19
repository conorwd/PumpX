'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface OrderStatus {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  type: 'buy' | 'sell';
  amount: number;
  status: 'pending' | 'success' | 'error' | 'removed';
  timestamp: number;
  signature?: string;
  error?: string;
  mintAddress: string;
}

interface TradingContextType {
  privateKey: string;
  setPrivateKey: (key: string) => void;
  autoBuyEnabled: boolean;
  setAutoBuyEnabled: (enabled: boolean) => void;
  followerCheckEnabled: boolean;
  setFollowerCheckEnabled: (enabled: boolean) => void;
  creationTimeEnabled: boolean;
  setCreationTimeEnabled: (enabled: boolean) => void;
  minFollowers: number;
  setMinFollowers: (count: number) => void;
  maxCreationTime: number;
  setMaxCreationTime: (minutes: number) => void;
  buyAmount: number;
  setBuyAmount: (amount: number) => void;
  slippage: number;
  setSlippage: (percentage: number) => void;
  orders: OrderStatus[];
  addOrder: (order: Omit<OrderStatus, 'id' | 'timestamp'>) => OrderStatus;
  updateOrder: (id: string, updates: Partial<OrderStatus>) => void;
  removeOrder: (id: string) => void;
}

const TradingContext = createContext<TradingContextType>({
  privateKey: '',
  setPrivateKey: () => {},
  autoBuyEnabled: false,
  setAutoBuyEnabled: () => {},
  followerCheckEnabled: false,
  setFollowerCheckEnabled: () => {},
  creationTimeEnabled: false,
  setCreationTimeEnabled: () => {},
  minFollowers: 1000,
  setMinFollowers: () => {},
  maxCreationTime: 5,
  setMaxCreationTime: () => {},
  buyAmount: 0.1,
  setBuyAmount: () => {},
  slippage: 1,
  setSlippage: () => {},
  orders: [],
  addOrder: () => ({ 
    id: '', 
    tokenSymbol: '', 
    tokenName: '', 
    type: 'buy', 
    amount: 0, 
    status: 'pending', 
    timestamp: 0,
    mintAddress: ''
  }),
  updateOrder: () => {},
  removeOrder: () => {},
});

export const useTradingContext = () => useContext(TradingContext);

export const TradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize state from localStorage if available
  const [privateKey, setPrivateKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('privateKey') || '';
    }
    return '';
  });
  const [autoBuyEnabled, setAutoBuyEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('autoBuyEnabled') === 'true';
    }
    return false;
  });
  const [followerCheckEnabled, setFollowerCheckEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('followerCheckEnabled') === 'true';
    }
    return false;
  });
  const [creationTimeEnabled, setCreationTimeEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('creationTimeEnabled') === 'true';
    }
    return false;
  });
  const [minFollowers, setMinFollowers] = useState(() => {
    if (typeof window !== 'undefined') {
      return Number(localStorage.getItem('minFollowers')) || 1000;
    }
    return 1000;
  });
  const [maxCreationTime, setMaxCreationTime] = useState(() => {
    if (typeof window !== 'undefined') {
      return Number(localStorage.getItem('maxCreationTime')) || 5;
    }
    return 5;
  });
  const [buyAmount, setBuyAmount] = useState(() => {
    if (typeof window !== 'undefined') {
      return Number(localStorage.getItem('buyAmount')) || 0.1;
    }
    return 0.1;
  });
  const [slippage, setSlippage] = useState(() => {
    if (typeof window !== 'undefined') {
      return Number(localStorage.getItem('slippage')) || 1;
    }
    return 1;
  });
  const [orders, setOrders] = useState<OrderStatus[]>([]);

  // Cleanup removed orders periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.filter(order => order.status !== 'removed'));
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Update localStorage when settings change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('privateKey', privateKey);
      localStorage.setItem('autoBuyEnabled', String(autoBuyEnabled));
      localStorage.setItem('followerCheckEnabled', String(followerCheckEnabled));
      localStorage.setItem('creationTimeEnabled', String(creationTimeEnabled));
      localStorage.setItem('minFollowers', String(minFollowers));
      localStorage.setItem('maxCreationTime', String(maxCreationTime));
      localStorage.setItem('buyAmount', String(buyAmount));
      localStorage.setItem('slippage', String(slippage));
    }
  }, [privateKey, autoBuyEnabled, followerCheckEnabled, creationTimeEnabled, minFollowers, maxCreationTime, buyAmount, slippage]);

  const addOrder = (order: Omit<OrderStatus, 'id' | 'timestamp'>) => {
    const newOrder: OrderStatus = {
      ...order,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    setOrders(prev => [newOrder, ...prev]);
    return newOrder;
  };

  const updateOrder = (id: string, updates: Partial<OrderStatus>) => {
    if (!updates) return;
    
    setOrders(prev => {
      // If the status is being updated to 'removed', remove the order
      if (updates?.status === 'removed') {
        return prev.filter(order => order.id !== id);
      }
      // Otherwise, update the order normally
      return prev.map(order => 
        order.id === id ? { ...order, ...updates } : order
      );
    });
  };

  const removeOrder = useCallback((id: string) => {
    setOrders(prev => prev.filter(order => order.id !== id));
  }, []);

  return (
    <TradingContext.Provider
      value={{
        privateKey,
        setPrivateKey,
        autoBuyEnabled,
        setAutoBuyEnabled,
        followerCheckEnabled,
        setFollowerCheckEnabled,
        creationTimeEnabled,
        setCreationTimeEnabled,
        minFollowers,
        setMinFollowers,
        maxCreationTime,
        setMaxCreationTime,
        buyAmount,
        setBuyAmount,
        slippage,
        setSlippage,
        orders,
        addOrder,
        updateOrder,
        removeOrder,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
};

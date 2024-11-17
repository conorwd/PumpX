'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface OrderStatus {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  type: 'buy' | 'sell';
  amount: number;
  status: 'pending' | 'success' | 'error';
  timestamp: number;
  signature?: string;
  error?: string;
  mintAddress: string;
}

interface TradingContextType {
  privateKey: string | null;
  setPrivateKey: (key: string | null) => void;
  buyAmount: number;
  setBuyAmount: (amount: number) => void;
  slippage: number;
  setSlippage: (slippage: number) => void;
  autoBuyEnabled: boolean;
  setAutoBuyEnabled: (enabled: boolean) => void;
  minFollowers: number;
  setMinFollowers: (followers: number) => void;
  updateInterval: number;
  setUpdateInterval: (interval: number) => void;
  orders: OrderStatus[];
  addOrder: (order: Omit<OrderStatus, 'id' | 'timestamp'>) => OrderStatus;
  updateOrder: (id: string, updates: Partial<OrderStatus>) => void;
}

const TradingContext = createContext<TradingContextType>({
  privateKey: null,
  setPrivateKey: () => {},
  buyAmount: 0.1,
  setBuyAmount: () => {},
  slippage: 25,
  setSlippage: () => {},
  autoBuyEnabled: false,
  setAutoBuyEnabled: () => {},
  minFollowers: 1000,
  setMinFollowers: () => {},
  updateInterval: 30,
  setUpdateInterval: () => {},
  orders: [],
  addOrder: () => ({} as OrderStatus),
  updateOrder: () => {},
});

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const [privateKey, setPrivateKey] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pumpfun_privateKey') || null;
    }
    return null;
  });

  const [buyAmount, setBuyAmount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const savedAmount = localStorage.getItem('pumpfun_buyAmount');
      return savedAmount ? parseFloat(savedAmount) : 0.1;
    }
    return 0.1;
  });

  const [slippage, setSlippage] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const savedSlippage = localStorage.getItem('pumpfun_slippage');
      return savedSlippage ? parseFloat(savedSlippage) : 1;
    }
    return 1;
  });

  const [autoBuyEnabled, setAutoBuyEnabled] = useState(false);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [updateInterval, setUpdateInterval] = useState(30);
  const [orders, setOrders] = useState<OrderStatus[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load initial values from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedAutoBuyEnabled = localStorage.getItem('autoBuyEnabled');
      const storedMinFollowers = Number(localStorage.getItem('minFollowers')) || 1000;
      const storedUpdateInterval = Number(localStorage.getItem('updateInterval')) || 30;

      setAutoBuyEnabled(storedAutoBuyEnabled === 'true');
      setMinFollowers(storedMinFollowers);
      setUpdateInterval(storedUpdateInterval);
      setIsInitialized(true);
    }
  }, []);

  // Cache privateKey changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (privateKey) {
      localStorage.setItem('pumpfun_privateKey', privateKey);
    } else {
      localStorage.removeItem('pumpfun_privateKey');
    }
  }, [privateKey]);

  // Cache buyAmount changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('pumpfun_buyAmount', buyAmount.toString());
  }, [buyAmount]);

  // Cache slippage changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('pumpfun_slippage', slippage.toString());
  }, [slippage]);

  // Save values to localStorage when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && isInitialized) {
      localStorage.setItem('autoBuyEnabled', autoBuyEnabled.toString());
      localStorage.setItem('minFollowers', minFollowers.toString());
      localStorage.setItem('updateInterval', updateInterval.toString());
    }
  }, [autoBuyEnabled, minFollowers, updateInterval, isInitialized]);

  const addOrder = useCallback((orderData: Omit<OrderStatus, 'id' | 'timestamp'>) => {
    const newOrder: OrderStatus = {
      ...orderData,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setOrders(prev => [newOrder, ...prev].slice(0, 50)); // Keep last 50 orders
    return newOrder;
  }, []);

  const updateOrder = useCallback((id: string, updates: Partial<OrderStatus>) => {
    setOrders(prev => 
      prev.map(order => 
        order.id === id ? { ...order, ...updates } : order
      )
    );
  }, []);

  const value = {
    privateKey,
    setPrivateKey,
    buyAmount,
    setBuyAmount,
    slippage,
    setSlippage,
    autoBuyEnabled,
    setAutoBuyEnabled,
    minFollowers,
    setMinFollowers,
    updateInterval,
    setUpdateInterval,
    orders,
    addOrder,
    updateOrder,
  };

  return (
    <TradingContext.Provider value={value}>
      {children}
    </TradingContext.Provider>
  );
}

export function useTradingContext() {
  const context = useContext(TradingContext);
  if (context === undefined) {
    throw new Error('useTradingContext must be used within a TradingProvider');
  }
  return context;
}

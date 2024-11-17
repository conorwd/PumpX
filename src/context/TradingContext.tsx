'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface OrderStatus {
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
  addOrder: (order: Omit<OrderStatus, 'id' | 'timestamp'>) => void;
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
  addOrder: () => {},
  updateOrder: () => {},
});

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [buyAmount, setBuyAmount] = useState(0.1);
  const [slippage, setSlippage] = useState(25);
  const [autoBuyEnabled, setAutoBuyEnabled] = useState(false);
  const [minFollowers, setMinFollowers] = useState(1000);
  const [updateInterval, setUpdateInterval] = useState(30);
  const [orders, setOrders] = useState<OrderStatus[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load initial values from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedPrivateKey = localStorage.getItem('privateKey');
      const storedBuyAmount = Number(localStorage.getItem('buyAmount')) || 0.1;
      const storedSlippage = Number(localStorage.getItem('slippage')) || 25;
      const storedUpdateInterval = Number(localStorage.getItem('updateInterval')) || 30;

      setPrivateKey(storedPrivateKey);
      setBuyAmount(storedBuyAmount);
      setSlippage(storedSlippage);
      setUpdateInterval(storedUpdateInterval);
      setIsInitialized(true);
    }
  }, []);

  const addOrder = useCallback((orderData: Omit<OrderStatus, 'id' | 'timestamp'>) => {
    const newOrder: OrderStatus = {
      ...orderData,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setOrders(prev => [newOrder, ...prev].slice(0, 50)); // Keep last 50 orders
  }, []);

  const updateOrder = useCallback((id: string, updates: Partial<OrderStatus>) => {
    setOrders(prev => 
      prev.map(order => 
        order.id === id ? { ...order, ...updates } : order
      )
    );
  }, []);

  // Save values to localStorage when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && isInitialized) {
      localStorage.setItem('privateKey', privateKey || '');
      localStorage.setItem('buyAmount', buyAmount.toString());
      localStorage.setItem('slippage', slippage.toString());
      localStorage.setItem('updateInterval', updateInterval.toString());
    }
  }, [privateKey, buyAmount, slippage, updateInterval, isInitialized]);

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

'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { API_BASE_URL } from '../lib/env'

interface Admin {
  id: number
  email: string
  name: string
}

interface AuthContextType {
  admin: Admin | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  register: (email: string, password: string, name: string) => Promise<void>
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 初始化:从 localStorage 读取 token
  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedAdmin = localStorage.getItem('admin')

    if (savedToken && savedAdmin) {
      setToken(savedToken)
      setAdmin(JSON.parse(savedAdmin))
    }

    setIsLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || '登录失败')
    }

    const data = await response.json()

    setToken(data.access_token)
    setAdmin(data.admin)

    localStorage.setItem('token', data.access_token)
    localStorage.setItem('admin', JSON.stringify(data.admin))
  }

  const register = async (email: string, password: string, name: string) => {
    const response = await fetch(`${API_BASE_URL}/api/admin/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || '注册失败')
    }

    // 注册后自动登录
    await login(email, password)
  }

  const logout = () => {
    setToken(null)
    setAdmin(null)
    localStorage.removeItem('token')
    localStorage.removeItem('admin')
  }

  return (
    <AuthContext.Provider value={{ admin, token, login, logout, register, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

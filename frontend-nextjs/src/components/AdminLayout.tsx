'use client'

import { ReactNode, useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'

import { useIsMobile } from '../hooks/useMediaQuery'

interface AdminLayoutProps {
  children: ReactNode
}

interface NavItem {
  path: string
  i18nKey: string
  icon: JSX.Element
  children?: { path: string; i18nKey: string }[]
}

const navItemsConfig: NavItem[] = [
  {
    path: '/',
    i18nKey: 'navigation.dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    )
  },
  {
    path: '/playground',
    i18nKey: 'navigation.playground',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )
  },
  {
    path: '/knowledge',
    i18nKey: 'navigation.knowledge',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    children: [
      { path: '/urls', i18nKey: 'navigation.websites' },
      { path: '/qa', i18nKey: 'navigation.qa' },
    ]
  },
  {
    path: '/sessions',
    i18nKey: 'navigation.sessions',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  },
  {
    path: '/settings/system',
    i18nKey: 'navigation.systemSettings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  },
]

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  const { admin, logout } = useAuth()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedNav, setExpandedNav] = useState<string | null>(null)

  // Auto-expand knowledge submenu if on a knowledge child page
  useEffect(() => {
    const knowledgeItem = navItemsConfig.find(item => item.path === '/knowledge')
    if (knowledgeItem?.children?.some(child => location.pathname === child.path)) {
      setExpandedNav('/knowledge')
    }
  }, [location.pathname])

  const navItems = navItemsConfig.map(item => ({
    ...item,
    label: t(item.i18nKey),
    children: item.children?.map(child => ({
      ...child,
      label: t(child.i18nKey)
    }))
  }))

  const isActive = (path: string) => location.pathname === path
  const isParentActive = (item: typeof navItems[0]) => 
    item.children?.some(child => location.pathname === child.path) || location.pathname === item.path

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNavClick = (item: typeof navItems[0], e?: React.MouseEvent) => {
    if (item.children) {
      e?.preventDefault()
      setExpandedNav(expandedNav === item.path ? null : item.path)
    } else {
      // Close submenu when clicking non-child nav items
      setExpandedNav(null)
      if (isMobile) {
        setSidebarOpen(false)
      }
    }
  }

  const handleChildNavClick = () => {
    // Keep parent expanded when clicking child items
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  const handleLogoClick = () => {
    setExpandedNav(null)
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  const SidebarContent = () => (
    <>
      <div style={{
        padding: 'var(--space-6)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }} onClick={handleLogoClick}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <img
                src="/logo.png"
                alt="Basjoo Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
            <div>
              <h1 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, #0EA5E9 0%, #F97316 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                Basjoo
              </h1>
              <span style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}>
                {t('tagline')}
              </span>
            </div>
          </Link>

        </div>
      </div>

      <nav style={{
        flex: 1,
        padding: 'var(--space-4)',
        overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}>
          {navItems.map((item) => (
            <div key={item.path}>
              {item.children ? (
                <>
                  <button
                    onClick={(e) => handleNavClick(item, e)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-3) var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      color: isParentActive(item) ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                      background: isParentActive(item) ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                      border: 'none',
                      fontSize: 'var(--text-sm)',
                      fontWeight: isParentActive(item) ? 500 : 400,
                      transition: 'all var(--transition-fast)',
                      position: 'relative',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {isParentActive(item) && (
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '3px',
                        height: '60%',
                        background: 'var(--color-accent-gradient)',
                        borderRadius: '0 2px 2px 0',
                      }} />
                    )}
                    <span style={{ 
                      display: 'flex',
                      opacity: isParentActive(item) ? 1 : 0.7,
                    }}>
                      {item.icon}
                    </span>
                    {item.label}
                    <svg 
                      width="12" 
                      height="12" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2"
                      style={{
                        marginLeft: 'auto',
                        transform: expandedNav === item.path ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform var(--transition-fast)',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {expandedNav === item.path && (
                    <div style={{
                      marginLeft: 'var(--space-8)',
                      marginTop: 'var(--space-1)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-1)',
                    }}>
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={handleChildNavClick}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            padding: 'var(--space-2) var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            color: isActive(child.path) ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                            background: isActive(child.path) ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                            textDecoration: 'none',
                            fontSize: 'var(--text-xs)',
                            fontWeight: isActive(child.path) ? 500 : 400,
                            transition: 'all var(--transition-fast)',
                          }}
                        >
                          <span style={{
                            width: '4px',
                            height: '4px',
                            borderRadius: '50%',
                            background: isActive(child.path) ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
                            opacity: isActive(child.path) ? 1 : 0.5,
                          }} />
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  to={item.path}
                  onClick={() => handleNavClick(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    color: isActive(item.path) ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    background: isActive(item.path) ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                    textDecoration: 'none',
                    fontSize: 'var(--text-sm)',
                    fontWeight: isActive(item.path) ? 500 : 400,
                    transition: 'all var(--transition-fast)',
                    position: 'relative',
                  }}
                >
                  {isActive(item.path) && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '3px',
                      height: '60%',
                      background: 'var(--color-accent-gradient)',
                      borderRadius: '0 2px 2px 0',
                    }} />
                  )}
                  <span style={{ 
                    display: 'flex',
                    opacity: isActive(item.path) ? 1 : 0.7,
                  }}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      </nav>

      <div style={{
        padding: 'var(--space-4)',
        borderTop: '1px solid var(--color-border)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-3)',
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            background: 'var(--color-accent-gradient)',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-inverse)',
          }}>
            {admin?.name?.charAt(0).toUpperCase() || 'A'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {admin?.name || t('navigation.administrator')}
            </div>
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {admin?.email}
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {t('buttons.logout')}
        </button>
      </div>
    </>
  )

  return (
    <div style={{ 
      display: 'flex', 
      minHeight: '100vh',
      background: 'var(--color-bg-primary)',
    }}>
      {/* Mobile Header */}
      {isMobile && (
        <header className="mobile-header">
          <button 
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <span style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #0EA5E9 0%, #F97316 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Basjoo AI
            </span>
          </Link>
          <div style={{ width: '40px' }} />
        </header>
      )}

      {/* Sidebar Overlay (Mobile) */}
      {isMobile && (
        <div 
          className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      {isMobile ? (
        <aside 
          className={`mobile-sidebar ${sidebarOpen ? 'open' : ''}`}
          style={{
            background: 'var(--color-bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SidebarContent />
        </aside>
      ) : (
        <aside style={{
          width: 'var(--sidebar-width)',
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
        }}>
          <SidebarContent />
        </aside>
      )}

      <main 
        className={isMobile ? 'mobile-main' : ''}
        style={{
          flex: 1,
          marginLeft: isMobile ? 0 : 'var(--sidebar-width)',
          minHeight: '100vh',
          overflow: 'auto',
        }}
      >
        {children}
      </main>
    </div>
  )
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../hooks/useMediaQuery';

interface HelpTooltipProps {
  title: string;
  content: string | string[];
  position?: 'top' | 'bottom' | 'left' | 'right';
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

/**
 * HelpTooltip - 统一的帮助提示组件
 *
 * 特点：
 * - 简洁的问号图标，无底色
 * - 点击/悬停显示详细说明
 * - 支持多段内容展示
 * - 使用Portal渲染，避免被父容器裁剪
 * - 自动边界检测和位置调整
 *
 * Restyle (spec §20): the trigger is the shared `.btn .btn-icon` (44px tap
 * target on mobile, per the `iconButtonStyle` idiom) and the floating panel is
 * a popover layer on tokens. Portal rendering, the hover/click/focus
 * behaviour, Escape/blur dismissal and the viewport boundary detection are
 * unchanged.
 */
export default function HelpTooltip({
  title,
  content,
  position = 'top',
  size = 'md'
}: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();

  const contentArray = Array.isArray(content) ? content : [content];

  // 计算tooltip位置
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 320; // minWidth + padding
    const tooltipHeight = 150; // 估计高度
    const gap = 8;
    const padding = 16; // 视口边距

    let newPosition = position;
    let style: React.CSSProperties = {};

    // 检查各方向空间是否足够
    const spaceTop = triggerRect.top - padding;
    const spaceBottom = window.innerHeight - triggerRect.bottom - padding;
    const spaceLeft = triggerRect.left - padding;
    const spaceRight = window.innerWidth - triggerRect.right - padding;

    // 根据空间自动调整位置
    if (position === 'top' && spaceTop < tooltipHeight && spaceBottom > tooltipHeight) {
      newPosition = 'bottom';
    } else if (position === 'bottom' && spaceBottom < tooltipHeight && spaceTop > tooltipHeight) {
      newPosition = 'top';
    } else if (position === 'left' && spaceLeft < tooltipWidth && spaceRight > tooltipWidth) {
      newPosition = 'right';
    } else if (position === 'right' && spaceRight < tooltipWidth && spaceLeft > tooltipWidth) {
      newPosition = 'left';
    }

    setAdjustedPosition(newPosition);

    // 计算最终位置
    switch (newPosition) {
      case 'top':
        style = {
          left: triggerRect.left + triggerRect.width / 2,
          top: triggerRect.top - gap,
          transform: 'translate(-50%, -100%)',
        };
        break;
      case 'bottom':
        style = {
          left: triggerRect.left + triggerRect.width / 2,
          top: triggerRect.bottom + gap,
          transform: 'translate(-50%, 0)',
        };
        break;
      case 'left':
        style = {
          left: triggerRect.left - gap,
          top: triggerRect.top + triggerRect.height / 2,
          transform: 'translate(-100%, -50%)',
        };
        break;
      case 'right':
        style = {
          left: triggerRect.right + gap,
          top: triggerRect.top + triggerRect.height / 2,
          transform: 'translate(0, -50%)',
        };
        break;
    }

    // 确保不超出视口边界
    const finalLeft = style.left as number;
    const finalTop = style.top as number;

    if (typeof finalLeft === 'number' && finalLeft < padding) {
      style.left = padding;
    }
    if (typeof finalTop === 'number' && finalTop < padding) {
      style.top = padding;
    }

    setTooltipStyle(style);
  }, [position]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 显示时计算位置
  useEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible, calculatePosition]);

  // Escape / blur dismissal
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVisible(false);
        triggerRef.current?.blur();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  // 窗口大小变化时重新计算 - 使用 ref 避免频繁重新注册
  useEffect(() => {
    if (!isVisible) return;

    // 使用 ref 保存回调，避免依赖问题
    const handleResize = () => {
      // 直接调用计算逻辑，而不是依赖 calculatePosition
      if (!tooltipRef.current || !triggerRef.current) return;

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const maxWidth = window.innerWidth - 32;
      const tooltipWidth = Math.min(320, maxWidth);

      let style: React.CSSProperties = {
        maxWidth: `${tooltipWidth}px`,
      };

      // 简化的位置计算逻辑
      switch (position) {
        case 'top':
          style.left = triggerRect.left + triggerRect.width / 2;
          style.top = triggerRect.top - 8;
          style.transform = 'translate(-50%, -100%)';
          break;
        case 'bottom':
          style.left = triggerRect.left + triggerRect.width / 2;
          style.top = triggerRect.bottom + 8;
          style.transform = 'translate(-50%, 0)';
          break;
        case 'left':
          style.left = triggerRect.left - 8;
          style.top = triggerRect.top + triggerRect.height / 2;
          style.transform = 'translate(-100%, -50%)';
          break;
        case 'right':
          style.left = triggerRect.right + 8;
          style.top = triggerRect.top + triggerRect.height / 2;
          style.transform = 'translate(0, -50%)';
          break;
      }

      setTooltipStyle(style);
    };

    // 初始计算
    handleResize();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [isVisible, position]); // 只依赖 isVisible 和 position

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible]);

  /**
   * Trigger size steps. The glyph stays inline with the label it annotates,
   * while the button itself is a 32px box on desktop and a >= 44px tap target
   * on mobile (`iconButtonStyle`, the mobileLayout idiom).
   */
  const sizeStyles = {
    xs: { width: '20px', minWidth: '20px', height: '20px', minHeight: '20px', fontSize: 'var(--text-xs)' },
    sm: { width: '24px', minWidth: '24px', height: '24px', minHeight: '24px', fontSize: 'var(--text-xs)' },
    md: { width: '28px', minWidth: '28px', height: '28px', minHeight: '28px', fontSize: 'var(--text-sm)' },
    lg: { width: '32px', minWidth: '32px', height: '32px', minHeight: '32px', fontSize: 'var(--text-base)' },
  };

  const iconButtonStyle = isMobile
    ? { minWidth: 44, minHeight: 44 }
    : undefined;

  const getArrowStyles = () => {
    const baseStyle = {
      position: 'absolute' as const,
      width: '0',
      height: '0',
    };

    const borderColor = 'var(--color-border)';

    switch (adjustedPosition) {
      case 'top':
        return {
          ...baseStyle,
          bottom: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: `6px solid ${borderColor}`,
        };
      case 'bottom':
        return {
          ...baseStyle,
          top: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderBottom: `6px solid ${borderColor}`,
        };
      case 'left':
        return {
          ...baseStyle,
          right: '-9px',
          top: '50%',
          transform: 'translateY(-50%)',
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderLeft: `6px solid ${borderColor}`,
        };
      case 'right':
        return {
          ...baseStyle,
          left: '-9px',
          top: '50%',
          transform: 'translateY(-50%)',
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderRight: `6px solid ${borderColor}`,
        };
      default:
        return {};
    }
  };

  const tooltipContent = isVisible && (
    <div
      ref={tooltipRef}
      role="tooltip"
      style={{
        position: 'fixed',
        zIndex: 10000,
        minWidth: '240px',
        maxWidth: '360px',
        padding: 'var(--space-4)',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        ...tooltipStyle,
        animation: 'tooltipFadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* 小箭头 */}
      <div style={getArrowStyles()} aria-hidden="true" />

      {/* 标题 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-accent-primary)',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        {title}
      </div>

      {/* 内容 */}
      <div
        style={{
          fontSize: 'var(--text-xs)',
          lineHeight: 'var(--leading-relaxed)',
          color: 'var(--fg-default)',
        }}
      >
        {contentArray.map((item, index) => (
          <div
            key={index}
            style={{
              marginBottom:
                index < contentArray.length - 1 ? 'var(--space-2)' : 0,
            }}
          >
            {item}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: ${tooltipStyle.transform || 'translate(-50%, -100%)'} translateY(4px);
          }
          to {
            opacity: 1;
            transform: ${tooltipStyle.transform || 'translate(-50%, -100%)'} translateY(0);
          }
        }
      `}</style>
    </div>
  );

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 'var(--space-1)',
        verticalAlign: 'middle',
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-icon"
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={isVisible}
        onClick={() => {
          calculatePosition();
          setIsVisible(!isVisible);
        }}
        onMouseEnter={() => {
          calculatePosition();
          setIsVisible(true);
          setIsHovered(true);
        }}
        onMouseLeave={() => {
          setIsVisible(false);
          setIsHovered(false);
        }}
        onFocus={() => {
          calculatePosition();
          setIsVisible(true);
        }}
        onBlur={() => {
          setIsVisible(false);
          setIsHovered(false);
        }}
        style={{
          ...sizeStyles[size],
          ...iconButtonStyle,
          padding: 0,
          borderRadius: 'var(--radius-full)',
          background: 'transparent',
          border: 'none',
          color: isHovered
            ? 'var(--color-accent-primary)'
            : 'var(--fg-dim)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 500,
          lineHeight: 1,
          transition: 'color var(--transition-fast)',
        }}
      >
        ?
      </button>

      {mounted && createPortal(tooltipContent, document.body)}
    </span>
  );
}
